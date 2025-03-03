const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = []; // Persist players globally

function broadcastPlayers() {
    const payload = JSON.stringify({ type: "updatePlayers", players });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on("connection", (ws) => {
    console.log("New player connected");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                console.log(`Player joined: ${data.name}`);
                players.push({ name: data.name, chips: 1000 }); // Add player with default chips
                broadcastPlayers(); // Notify all clients
            }

            if (data.type === "move") {
                console.log(`Player Move: ${data.name} ${data.move} ${data.amount}`);
                // Handle moves like betting (update logic if needed)
            }
        } catch (error) {
            console.error("Invalid message format:", message);
        }
    });

    ws.on("close", () => {
        console.log("A player disconnected.");
        players = players.filter(player => player.ws !== ws); // Remove player on disconnect
        broadcastPlayers(); // Notify all clients
    });
});

server.listen(3000, () => console.log("Server running on port 3000"));
