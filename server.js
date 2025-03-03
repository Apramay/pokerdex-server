const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = []; // Store connected players

wss.on("connection", (ws) => {
    console.log("✅ New player connected");

    ws.on("message", (message) => {
        console.log("📩 Received message:", message);

        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                console.log(`👤 Player joined: ${data.name}`);

                // Add player to list
                players.push({ name: data.name, chips: 1000 });

                // Broadcast updated players list to all clients
                broadcastPlayers();
            }
        } catch (error) {
            console.error("❌ Error parsing message:", error);
        }
    });

    ws.on("close", () => {
        console.log("❌ A player disconnected");
    });
});

// Function to send updated player list
function broadcastPlayers() {
    const update = JSON.stringify({ type: "updatePlayers", players });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(update);
        }
    });
}

server.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
