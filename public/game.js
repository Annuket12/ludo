
const socket = io();

const $ = id => document.getElementById(id);

let myId = null;
let myRoom = null;
let state = null;

let visualPositions = null;
let animationLock = false;

const colors = ["red", "green", "yellow", "blue"];

const track = [
    [6,1],[6,2],[6,3],[6,4],[6,5],
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
    [0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
    [7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
    [14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
    [7,0],[6,0]
];

const homeLanes = {
    red: [
        [7,1],[7,2],[7,3],[7,4],[7,5]
    ],
    green: [
        [1,7],[2,7],[3,7],[4,7],[5,7]
    ],
    yellow: [
        [7,13],[7,12],[7,11],[7,10],[7,9]
    ],
    blue: [
        [13,7],[12,7],[11,7],[10,7],[9,7]
    ]
};

const bases = {
    red: [
        [1,1],[1,4],[4,1],[4,4]
    ],
    green: [
        [1,10],[1,13],[4,10],[4,13]
    ],
    yellow: [
        [10,10],[10,13],[13,10],[13,13]
    ],
    blue: [
        [10,1],[10,4],[13,1],[13,4]
    ]
};

const offsets = {
    red: 0,
    green: 13,
    yellow: 26,
    blue: 39
};

const safeSquares = [0,8,13,21,26,34,39,47];

const finishSpots = {
    red: [7,6],
    green: [6,7],
    yellow: [7,8],
    blue: [8,7]
};

function showMessage(message) {
    $("message").textContent = message;
}

function showPage(page) {
    $("home").hidden = page !== "home";
    $("lobby").hidden = page !== "lobby";
    $("game").hidden = page !== "game";
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// CONNECTION

socket.on("connect", () => {
    myId = socket.id;
});

socket.on("connect_error", () => {
    showMessage("Server connection failed!");
});


// CREATE ROOM

$("createRoom").onclick = () => {
    const name = $("playerName").value.trim();

    if (!name) {
        showMessage("Please enter your name!");
        return;
    }

    socket.emit("createRoom", name);
};


// JOIN ROOM

$("joinRoom").onclick = () => {
    const name = $("playerName").value.trim();
    const code = $("roomCode").value.trim().toUpperCase();

    if (!name || !code) {
        showMessage("Enter your name and room code!");
        return;
    }

    socket.emit("joinRoom", { name, code });
};


// ROOM EVENTS

socket.on("roomCreated", code => {
    myRoom = code;
    $("roomTitle").textContent = code;
    showPage("lobby");
});

socket.on("roomJoined", code => {
    myRoom = code;
    $("roomTitle").textContent = code;
    showPage("lobby");
});

socket.on("errorMessage", message => {
    showMessage(message);
});

$("copyCode").onclick = async () => {
    try {
        await navigator.clipboard.writeText(myRoom);
        showMessage("Room code copied!");
    } catch {
        showMessage("Room code: " + myRoom);
    }
};

$("startGame").onclick = () => {
    socket.emit("startGame");
};


// DICE EVENTS

$("rollDice").onclick = () => {
    socket.emit("rollDice");
};

$("centerDice").onclick = () => {
    socket.emit("rollDice");
};


// ROOM STATE

socket.on("roomUpdate", data => {
    const previousState = state;

    state = data;
    myRoom = data.code;

    if (data.started) {
        showPage("game");
        $("gameRoom").textContent = data.code;

        const movement = findMovement(previousState, data);

        if (movement && !animationLock) {
            animateMovement(previousState, data, movement);
        } else {
            visualPositions = null;
            renderGame();
        }

        return;
    }

    visualPositions = null;
    animationLock = false;

    showPage("lobby");

    $("roomTitle").textContent = data.code;

    $("playerCount").textContent =
        data.players.length + " / 4 players connected";

    $("playerList").innerHTML = "";

    data.players.forEach(player => {
        const li = document.createElement("li");

        li.textContent =
            player.name + " — " + player.color.toUpperCase();

        $("playerList").appendChild(li);
    });

    const isHost = data.hostId === myId;

    $("startGame").hidden = !isHost;
    $("startGame").disabled = data.players.length < 2;

    $("waitingText").textContent = isHost
        ? "You are the host. Start when friends join."
        : "Waiting for the host to start...";
});


// FIND WHICH TOKEN MOVED

function findMovement(oldState, newState) {
    if (!oldState || !oldState.started) return null;

    for (const newPlayer of newState.players) {
        const oldPlayer = oldState.players.find(
            player => player.id === newPlayer.id
        );

        if (!oldPlayer) continue;

        for (let i = 0; i < 4; i++) {
            const oldPosition = oldPlayer.tokens[i];
            const newPosition = newPlayer.tokens[i];

            const movedForward =
                (oldPosition === -1 && newPosition === 0) ||
                (
                    oldPosition >= 0 &&
                    newPosition > oldPosition
                );

            if (movedForward) {
                return {
                    playerId: newPlayer.id,
                    tokenIndex: i,
                    oldPosition,
                    newPosition
                };
            }
        }
    }

    return null;
}


// STEP-BY-STEP MOVEMENT ANIMATION

async function animateMovement(oldState, newState, movement) {
    animationLock = true;

    visualPositions = {};

    // Initially display all tokens at their previous positions.
    oldState.players.forEach(player => {
        visualPositions[player.id] = [...player.tokens];
    });

    renderGame();

    const {
        playerId,
        tokenIndex,
        oldPosition,
        newPosition
    } = movement;

    // A token leaving its base starts at track position 0.
    let currentPosition = oldPosition === -1
        ? 0
        : oldPosition;

    // Move one square at a time.
    while (currentPosition < newPosition) {
        currentPosition++;

        visualPositions[playerId][tokenIndex] =
            currentPosition;

        renderGame();

        await delay(125);
    }

    // Show captures and all final positions after movement.
    visualPositions = null;

    animationLock = false;

    renderGame();
}


// BOARD CREATION

function makeBoard() {
    const board = $("board");

    board.innerHTML = "";

    const cells = [];

    for (let r = 0; r < 15; r++) {
        for (let c = 0; c < 15; c++) {
            const cell = document.createElement("div");

            cell.className = "cell";

            // Home areas
            if (r < 6 && c < 6) {
                cell.classList.add("red-home");
            }

            if (r < 6 && c > 8) {
                cell.classList.add("green-home");
            }

            if (r > 8 && c < 6) {
                cell.classList.add("blue-home");
            }

            if (r > 8 && c > 8) {
                cell.classList.add("yellow-home");
            }

            // Main track
            const trackIndex = track.findIndex(
                ([y, x]) => y === r && x === c
            );

            if (trackIndex !== -1) {
                cell.className = "cell track";

                if (safeSquares.includes(trackIndex)) {
                    cell.classList.add("safe");
                }

                if ([0, 13, 26, 39].includes(trackIndex)) {
                    cell.classList.add("start-square");
                }
            }

            // Home lanes
            Object.entries(homeLanes).forEach(([color, lane]) => {
                if (lane.some(([y, x]) => y === r && x === c)) {
                    cell.className = "cell lane-" + color;
                }
            });

            // Centre finish area
            if (r === 7 && c === 7) {
                cell.className = "cell center-core";
                cell.textContent = "★";
            } else if (r === 7 && c === 6) {
                cell.className = "cell finish-red";
            } else if (r === 6 && c === 7) {
                cell.className = "cell finish-green";
            } else if (r === 7 && c === 8) {
                cell.className = "cell finish-yellow";
            } else if (r === 8 && c === 7) {
                cell.className = "cell finish-blue";
            }

            cells.push(cell);
            board.appendChild(cell);
        }
    }


    // HOME BASE CIRCLES

    Object.entries(bases).forEach(([color, positions]) => {
        positions.forEach(([r, c]) => {
            const cell = cells[r * 15 + c];

            cell.classList.add("base-cell");

            const dot = document.createElement("div");

            dot.className = "base-dot base-dot-" + color;

            cell.appendChild(dot);
        });
    });

    return cells;
}


// GET TOKEN LOCATION

function getTokenCell(player, position, index) {
    if (position === -1) {
        return bases[player.color][index];
    }

    if (position >= 0 && position <= 51) {
        const globalIndex =
            (offsets[player.color] + position) % 52;

        return track[globalIndex];
    }

    if (position >= 52 && position <= 56) {
        return homeLanes[player.color][position - 52];
    }

    if (position === 57) {
        return finishSpots[player.color];
    }

    return null;
}


// GET CURRENT DISPLAY POSITION

function getDisplayPosition(player, index) {
    if (visualPositions?.[player.id]) {
        return visualPositions[player.id][index];
    }

    return player.tokens[index];
}


// GAME RENDER

function renderGame() {
    if (!state || !state.started) return;

    const cells = makeBoard();

    const currentPlayer = state.players.find(
        player => player.id === state.turnPlayerId
    );

    const isMyTurn = state.turnPlayerId === myId;
    const hasWinner = !!state.winner;


    // PLAYER CARDS

    $("playersBar").innerHTML = "";

    state.players.forEach(player => {
        const card = document.createElement("div");

        card.className = "player-card";

        card.classList.add("card-" + player.color);

        if (player.id === state.turnPlayerId && !hasWinner) {
            card.classList.add("active");
        }

        const dot = document.createElement("span");

        dot.className = "player-dot dot-" + player.color;

        const name = document.createElement("span");

        name.textContent = player.name;

        card.append(dot, name);

        $("playersBar").appendChild(card);
    });


    // TURN INFORMATION

    if (hasWinner) {
        const winner = state.players.find(
            player => player.id === state.winner
        );

        $("turnInfo").textContent =
            winner ? winner.name + " WON! 🏆" : "Game over";

        $("gameMessage").textContent =
            "Congratulations! You won the match.";

    } else {
        $("turnInfo").textContent = currentPlayer
            ? currentPlayer.name + "'s turn"
            : "Waiting...";

        if (animationLock) {
            $("gameMessage").textContent =
                "Moving token...";

        } else if (state.notice) {
            $("gameMessage").textContent = state.notice;

        } else if (!isMyTurn) {
            $("gameMessage").textContent =
                "Waiting for " + (currentPlayer?.name || "player");

        } else if (state.dice === null) {
            $("gameMessage").textContent =
                "Tap the dice to roll!";

        } else {
            $("gameMessage").textContent =
                "Select a highlighted token!";
        }
    }


    // DICE DISPLAY

    $("diceFace").textContent =
        state.dice !== null
            ? state.dice
            : "🎲";

    $("diceLabel").textContent =
        state.dice === null
            ? "ROLL"
            : "RESULT";

    const diceEnabled =
        isMyTurn &&
        state.dice === null &&
        !hasWinner &&
        !state.pendingAutoPass &&
        !animationLock;

    $("centerDice").disabled = !diceEnabled;
    $("centerDice").classList.toggle(
        "disabled",
        !diceEnabled
    );

    $("rollDice").disabled = !diceEnabled;


    // DRAW TOKENS

    state.players.forEach(player => {
        player.tokens.forEach((originalPosition, index) => {
            const position = getDisplayPosition(player, index);

            const coord = getTokenCell(
                player,
                position,
                index
            );

            if (!coord) return;

            const [r, c] = coord;

            const cell = cells[r * 15 + c];

            let stack = cell.querySelector(".token-stack");

            if (!stack) {
                stack = document.createElement("div");

                stack.className = "token-stack";

                cell.appendChild(stack);
            }

            const token = document.createElement("button");

            token.className =
                "token " + player.color;

            token.textContent = index + 1;

            const selectable =
                player.id === myId &&
                isMyTurn &&
                !hasWinner &&
                !animationLock &&
                state.canMove.includes(index);

            if (selectable) {
                token.classList.add("selectable");

                token.title =
                    "Move " + player.color + " token " + (index + 1);

                token.onclick = () => {
                    if (!animationLock) {
                        socket.emit("moveToken", index);
                    }
                };

            } else {
                token.disabled = true;
            }

            stack.appendChild(token);
        });
    });
}
