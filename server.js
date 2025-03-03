const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = []; // ✅ Ensure players are stored persistently in memory

wss.on("connection", (ws) => {
    console.log("✅ New player connected");

    // ✅ Immediately send the latest players list to the new connection
    ws.send(JSON.stringify({ type: "updatePlayers", players.map(p => ({ name: p.name, chips: p.chips })) }));

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                console.log(`👤 Player joined: ${data.name}`);

                // ✅ Prevent duplicates
                if (!players.some(player => player.name === data.name)) {
                    players.push({ name: data.name, chips: 1000, ws }); // ✅ Store WebSocket
                }

                // ✅ Broadcast updated players list to ALL clients
                broadcast({ type: "updatePlayers", players.map(p => ({ name: p.name, chips: p.chips })) });
            }
        } catch (error) {
            console.error("❌ Error handling message:", error);
        }
    });

    ws.on("close", () => {
        console.log("🚪 A player disconnected");

        // ✅ Find and remove the disconnected player
        players = players.filter(player => player.ws !== ws);

        // ✅ Broadcast updated player list
        broadcast({ type: "updatePlayers", players.map(p => ({ name: p.name, chips: p.chips })) });
    });
});


// ✅ Broadcast function ensures all players receive updates
function broadcast(data) {
    const jsonData = JSON.stringify(data);
    console.log("📢 Broadcasting to all players:", jsonData);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

server.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
