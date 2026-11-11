const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

const COLORS = ["red", "green", "yellow", "blue"];
const SAFE = [0, 8, 13, 21, 26, 34, 39, 47];

const AUTO_PASS_DELAY = 1000;

function makeCode() {
    let code;

    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms[code]);

    return code;
}

function clearAutoTimer(game) {
    if (game?.autoTimer) {
        clearTimeout(game.autoTimer);
        game.autoTimer = null;
    }
}

function nextTurn(room) {
    const game = room.game;

    if (!game) return;

    clearAutoTimer(game);

    game.turnIndex =
        (game.turnIndex + 1) % room.players.length;

    game.dice = null;
    game.canMove = [];
    game.pendingAutoPass = false;
    game.consecutiveSixes = 0;
    game.notice = "";
}

function sendState(code) {
    const room = rooms[code];

    if (!room) return;

    const game = room.game;

    io.to(code).emit("roomUpdate", {
        code,
        hostId: room.hostId,

        players: room.players.map(player => ({
            id: player.id,
            name: player.name,
            color: player.color,

            tokens: game
                ? [...game.tokens[player.id]]
                : [-1, -1, -1, -1]
        })),

        started: !!game,

        turnPlayerId: game
            ? room.players[game.turnIndex]?.id
            : null,

        dice: game?.dice ?? null,
        canMove: game?.canMove ?? [],
        winner: game?.winner ?? null,

        pendingAutoPass: game?.pendingAutoPass ?? false,
        consecutiveSixes: game?.consecutiveSixes ?? 0,
        notice: game?.notice ?? ""
    });
}

function getGlobalPosition(player, position) {
    return (
        position + COLORS.indexOf(player.color) * 13
    ) % 52;
}

// Check whether an opponent has a blockade on a square.
function isEnemyBlockade(player, globalPosition, room, game) {
    for (const opponent of room.players) {
        if (opponent.id === player.id) continue;

        const count = game.tokens[opponent.id].filter(position => {
            return (
                position >= 0 &&
                position <= 51 &&
                getGlobalPosition(opponent, position) === globalPosition
            );
        }).length;

        if (count >= 2) {
            return true;
        }
    }

    return false;
}

// Validate a token's complete movement before accepting it.
function isLegalMove(player, position, dice, room, game) {
    if (position === 57) return false;

    if (position === -1) {
        if (dice !== 6) return false;
    }

    const nextPosition = position === -1
        ? 0
        : position + dice;

    // Exact number is required to finish.
    if (nextPosition > 57) {
        return false;
    }

    // Check every outer-track square crossed.
    const firstStep = position === -1
        ? 0
        : position + 1;

    const lastStep = Math.min(nextPosition, 51);

    for (let step = firstStep; step <= lastStep; step++) {
        const globalPosition = getGlobalPosition(player, step);

        if (
            isEnemyBlockade(
                player,
                globalPosition,
                room,
                game
            )
        ) {
            return false;
        }
    }

    return true;
}

function getLegalMoves(player, room, game, dice) {
    const tokens = game.tokens[player.id];
    const moves = [];

    tokens.forEach((position, index) => {
        if (
            isLegalMove(
                player,
                position,
                dice,
                room,
                game
            )
        ) {
            moves.push(index);
        }
    });

    return moves;
}

// Capture an opponent's single token on a non-safe square.
function captureTokens(player, position, room, game) {
    if (position < 0 || position > 51) {
        return false;
    }

    const landing = getGlobalPosition(player, position);

    if (SAFE.includes(landing)) {
        return false;
    }

    let captured = false;

    room.players.forEach(opponent => {
        if (opponent.id === player.id) return;

        const opponentTokens = game.tokens[opponent.id];

        const tokensOnSquare = opponentTokens
            .map((pos, index) => ({ pos, index }))
            .filter(({ pos }) => {
                return (
                    pos >= 0 &&
                    pos <= 51 &&
                    getGlobalPosition(opponent, pos) === landing
                );
            });

        // A pair of tokens forms a blockade and cannot be captured.
        if (tokensOnSquare.length !== 1) return;

        opponentTokens[tokensOnSquare[0].index] = -1;
        captured = true;
    });

    return captured;
}

function scheduleAutomaticPass(code, room, message) {
    const game = room.game;

    if (!game) return;

    clearAutoTimer(game);

    game.pendingAutoPass = true;
    game.notice = message;

    sendState(code);

    game.autoTimer = setTimeout(() => {
        if (
            rooms[code] !== room ||
            room.game !== game ||
            !game.pendingAutoPass
        ) {
            return;
        }

        nextTurn(room);
        sendState(code);

    }, AUTO_PASS_DELAY);
}


// SOCKET.IO

io.on("connection", socket => {
    console.log("Connected:", socket.id);


    // CREATE ROOM

    socket.on("createRoom", name => {
        name = String(name || "").trim().slice(0, 20);

        if (!name) {
            return socket.emit(
                "errorMessage",
                "Enter your name!"
            );
        }

        const code = makeCode();

        rooms[code] = {
            hostId: socket.id,

            players: [{
                id: socket.id,
                name,
                color: "red"
            }],

            game: null
        };

        socket.join(code);
        socket.data.roomCode = code;

        socket.emit("roomCreated", code);

        sendState(code);
    });


    // JOIN ROOM

    socket.on("joinRoom", ({ name, code } = {}) => {
        name = String(name || "").trim().slice(0, 20);
        code = String(code || "").trim().toUpperCase();

        const room = rooms[code];

        if (!name || !room) {
            return socket.emit(
                "errorMessage",
                "Room not found!"
            );
        }

        if (room.game) {
            return socket.emit(
                "errorMessage",
                "Game already started!"
            );
        }

        if (room.players.length >= 4) {
            return socket.emit(
                "errorMessage",
                "Room is full!"
            );
        }

        room.players.push({
            id: socket.id,
            name,
            color: COLORS[room.players.length]
        });

        socket.join(code);
        socket.data.roomCode = code;

        socket.emit("roomJoined", code);

        sendState(code);
    });


    // START GAME

    socket.on("startGame", () => {
        const code = socket.data.roomCode;
        const room = rooms[code];

        if (!room || room.hostId !== socket.id) return;

        if (room.players.length < 2) {
            return socket.emit(
                "errorMessage",
                "At least 2 players needed!"
            );
        }

        if (room.game) return;

        const tokens = {};

        room.players.forEach(player => {
            tokens[player.id] = [-1, -1, -1, -1];
        });

        room.game = {
            turnIndex: 0,
            dice: null,
            canMove: [],
            tokens,
            winner: null,

            consecutiveSixes: 0,
            pendingAutoPass: false,
            autoTimer: null,
            notice: "Game started! Roll the dice."
        };

        sendState(code);
    });


    // ROLL DICE

    socket.on("rollDice", () => {
        const code = socket.data.roomCode;
        const room = rooms[code];

        if (!room || !room.game || room.game.winner) return;

        const game = room.game;
        const player = room.players[game.turnIndex];

        if (!player || player.id !== socket.id) return;

        if (
            game.dice !== null ||
            game.pendingAutoPass
        ) {
            return;
        }

        const dice = Math.floor(Math.random() * 6) + 1;

        game.dice = dice;
        game.canMove = [];
        game.notice = "";


        // Count consecutive sixes.
        if (dice === 6) {
            game.consecutiveSixes++;
        } else {
            game.consecutiveSixes = 0;
        }


        // Three consecutive sixes cancel the turn.
        if (game.consecutiveSixes === 3) {
            scheduleAutomaticPass(
                code,
                room,
                "Three consecutive sixes! Turn cancelled."
            );

            return;
        }


        game.canMove = getLegalMoves(
            player,
            room,
            game,
            dice
        );


        // No legal move after a six:
        // Same player gets another roll.
        if (game.canMove.length === 0 && dice === 6) {
            game.dice = null;

            game.notice =
                "No valid move! You got another roll for your six.";

            sendState(code);
            return;
        }


        // No legal move after 1-5:
        // Automatically pass the turn.
        if (game.canMove.length === 0) {
            scheduleAutomaticPass(
                code,
                room,
                "No valid move. Passing turn automatically..."
            );

            return;
        }

        sendState(code);
    });


    // MOVE TOKEN

    socket.on("moveToken", index => {
        const code = socket.data.roomCode;
        const room = rooms[code];

        if (!room || !room.game || room.game.winner) return;

        const game = room.game;
        const player = room.players[game.turnIndex];

        if (!player || player.id !== socket.id) return;

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index > 3
        ) {
            return;
        }

        if (game.pendingAutoPass) return;
        if (!game.canMove.includes(index)) return;

        const dice = game.dice;
        const tokens = game.tokens[player.id];

        const oldPosition = tokens[index];

        // Validate again before accepting the move.
        if (
            !isLegalMove(
                player,
                oldPosition,
                dice,
                room,
                game
            )
        ) {
            return;
        }

        const newPosition = oldPosition === -1
            ? 0
            : oldPosition + dice;

        tokens[index] = newPosition;


        // Capture opponent if possible.
        const captured = captureTokens(
            player,
            newPosition,
            room,
            game
        );

        const reachedFinish = newPosition === 57;


        // WIN CHECK

        if (tokens.every(position => position === 57)) {
            clearAutoTimer(game);

            game.winner = player.id;
            game.dice = null;
            game.canMove = [];
            game.pendingAutoPass = false;

            game.notice =
                `${player.name} has won the game!`;

            sendState(code);
            return;
        }


        game.dice = null;
        game.canMove = [];


        // BONUS TURN
        // Six, capture or finishing a token.

        const bonusTurn =
            dice === 6 ||
            captured ||
            reachedFinish;

        if (bonusTurn) {
            if (captured && reachedFinish) {
                game.notice =
                    "Capture and finish! Bonus turn!";

            } else if (captured) {
                game.notice =
                    "Great capture! Roll again!";

            } else if (reachedFinish) {
                game.notice =
                    "Token reached home! Bonus turn!";

            } else {
                game.notice =
                    "You rolled a six! Roll again!";
            }

            sendState(code);
            return;
        }


        // Normal turn ends.
        nextTurn(room);

        sendState(code);
    });


    // DISCONNECT

    socket.on("disconnect", () => {
        const code = socket.data.roomCode;
        const room = rooms[code];

        if (!room) return;

        const wasHost = room.hostId === socket.id;

        room.players = room.players.filter(
            player => player.id !== socket.id
        );

        if (room.players.length === 0) {
            clearAutoTimer(room.game);
            delete rooms[code];
            return;
        }

        if (wasHost) {
            room.hostId = room.players[0].id;
        }

        // Return remaining players to lobby.
        if (room.game) {
            clearAutoTimer(room.game);
            room.game = null;
        }

        sendState(code);
    });

});


server.listen(process.env.PORT || 3000, () => {
    console.log(
        "Ludo server running on port " +
        (process.env.PORT || 3000)
    );
});