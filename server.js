const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];

wss.on("connection", (ws) => {
    console.log("New player connected");

    ws.on("message", (message) => {
        const data = JSON.parse(message);
        if (data.type === "join") {
            players.push({ id: ws, name: data.name });
            console.log(`${data.name} joined the game.`);

            // Broadcast updated player list
            broadcast({ type: "players", players: players.map(p => p.name) });
        }
    });

    ws.on("close", () => {
        players = players.filter(p => p.id !== ws);
        console.log("A player disconnected.");

        // Broadcast updated player list
        broadcast({ type: "players", players: players.map(p => p.name) });
    });
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`WebSocket server running on port ${PORT}`));
