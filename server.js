const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = []; // Global players list

function broadcastPlayers() {
    const payload = JSON.stringify({ type: "updatePlayers", players });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on("connection", (ws) => {
    console.log("New WebSocket connection established.");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                console.log(`Player joined: ${data.name}`);
                
                // Check if player already exists
                if (!players.find(player => player.name === data.name)) {
                    players.push({ name: data.name, chips: 1000, ws });
                    broadcastPlayers();
                }
            }

            if (data.type === "move") {
                console.log(`Player Move: ${data.name} ${data.move} ${data.amount}`);
                // Handle bet/move logic
            }
        } catch (error) {
            console.error("Invalid message format:", message);
        }
    });

    ws.on("close", () => {
        console.log("A player disconnected.");
        players = players.filter(player => player.ws !== ws); // Remove the player
        broadcastPlayers(); // Update all clients
    });
});

server.listen(3000, () => console.log("Server running on port 3000"));
