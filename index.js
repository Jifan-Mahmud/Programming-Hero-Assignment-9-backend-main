require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 5000;
const url = process.env.MONGODB_URL;

// Middleware
app.use();
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      "http://localhost:3000",
      "http://localhost:3001",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(url, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


async function run() {
  try {
    await client.connect();
    console.log("Connected successfully to MongoDB!");

    const db = client.db("studynook_db");
    const defaultRoomsCollection = db.collection("default_rooms");


    app.get("/api/auth/me", authMiddleware, async (req, res) => {
      try {
        const payload = {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          photoURL: req.user.photoURL,
        };
        const token = await issueJwtAndSetCookie(res, payload);

        res.json({
          token,
          user: {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
            photoURL: req.user.photoURL,
            image: req.user.photoURL,
          },
        });
      } catch (error) {
        console.error("Fetch profile error:", error);
        res.status(500).json({ message: "Failed to fetch user profile" });
      }
    });

    // Logout: Clear JWT and Session cookies
    const handleLogout = (req, res) => {
      res.clearCookie("token", { path: "/" });
      res.clearCookie("jwt_token", { path: "/" });
      res.clearCookie("better-auth.session_token", { path: "/" });
      res.clearCookie("__Secure-better-auth.session_token", { path: "/" });
      res.json({ success: true, message: "Logged out successfully and cookies cleared" });
    };
      
    app.get("/api/default-rooms", async (req, res) => {
      try {
        const defaultRooms = await defaultRoomsCollection.find().toArray();
        res.json(defaultRooms);
      } catch (error) {
        console.error("Fetch default rooms error:", error);
        res.status(500).json({ message: "Failed to fetch default rooms" });
      }
    });
     app.get("/api/rooms/:id", async (req, res) => {
          try {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) {
              return res.status(400).json({ message: "Invalid Room ID" });
            }
            let room = await roomsCollection.findOne({ _id: new ObjectId(id) });
            if (!room) {
              room = await defaultRoomsCollection.findOne({ _id: new ObjectId(id) });
            }
            if (!room) {
              return res.status(404).json({ message: "Room not found" });
            }
            res.json(room);
          } catch (error) {
            res.status(500).json({ message: "Failed to fetch room details" });
          }
        });

         // Create a new room (Owner)
    app.post("/api/rooms", authMiddleware, async (req, res) => {
      try {
        const { name, description, image, floor, capacity, hourlyRate, amenities } = req.body;

        if (!name || !description || !image || !floor || !capacity || !hourlyRate) {
          return res.status(400).json({ message: "Please fill in all required room fields." });
        }

        const newRoom = {
          name,
          description,
          image,
          floor: String(floor),
          capacity: Number(capacity),
          hourlyRate: Number(hourlyRate),
          amenities: Array.isArray(amenities) ? amenities : [],
          ownerId: req.user.id,
          ownerName: req.user.name,
          ownerEmail: req.user.email,
          bookingCount: 0,
          createdAt: new Date(),
        };

        const result = await roomsCollection.insertOne(newRoom);
        res.status(201).json({
          success: true,
          message: "Room added successfully",
          room: { _id: result.insertedId, ...newRoom },
        });
      } catch (error) {
        console.error("Add Room Error:", error);
        res.status(500).json({ message: "Failed to add study room" });
      }
    });

     // Create a new room (Owner)
    app.post("/api/rooms", authMiddleware, async (req, res) => {
      try {
        const { name, description, image, floor, capacity, hourlyRate, amenities } = req.body;

        if (!name || !description || !image || !floor || !capacity || !hourlyRate) {
          return res.status(400).json({ message: "Please fill in all required room fields." });
        }

        const newRoom = {
          name,
          description,
          image,
          floor: String(floor),
          capacity: Number(capacity),
          hourlyRate: Number(hourlyRate),
          amenities: Array.isArray(amenities) ? amenities : [],
          ownerId: req.user.id,
          ownerName: req.user.name,
          ownerEmail: req.user.email,
          bookingCount: 0,
          createdAt: new Date(),
        };

        const result = await roomsCollection.insertOne(newRoom);
        res.status(201).json({
          success: true,
          message: "Room added successfully",
          room: { _id: result.insertedId, ...newRoom },
        });
      } catch (error) {
        console.error("Add Room Error:", error);
        res.status(500).json({ message: "Failed to add study room" });
      }
    });
    

    app.get("/", (req, res) => {
      res.send("StudyNook Server API is running smoothly!");
    });

    app.listen(port, () => {
      console.log(`StudyNook backend server listening on port ${port}`);
    });
  } catch (err) {
    console.error("MongoDB Connection Failed:", err);
  }
}

run().catch(console.dir);
