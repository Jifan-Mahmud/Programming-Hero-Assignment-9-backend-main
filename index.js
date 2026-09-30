require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 5000;
const url = process.env.MONGODB_URL;
const JWT_SECRET = process.env.JWT_SECRET || "studynook_jwt_secret_key_2026_secure";


const jwtSecretKey = new TextEncoder().encode(JWT_SECRET);

// Helper to sign JWT using jose-cjs
const signJwtToken = async (payload) => {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(jwtSecretKey);
};

// Helper to verify JWT using jose-cjs
const verifyJwtToken = async (token) => {
  const { payload } = await jwtVerify(token, jwtSecretKey);
  return payload;
};
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
     // Delete room (Owner only check & $pull from user bookings)
        app.delete("/api/rooms/:id", authMiddleware, async (req, res) => {
          try {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) {
              return res.status(400).json({ message: "Invalid Room ID" });
            }
    
            const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
            if (!room) {
              return res.status(404).json({ message: "Room not found" });
            }
    
            if (room.ownerId !== req.user.id) {
              return res.status(403).json({ message: "Forbidden: You can only delete your own rooms." });
            }
    
            // Find related bookings
            const relatedBookings = await bookingsCollection
              .find({ roomId: new ObjectId(id) })
              .toArray();
            const bookingIds = relatedBookings.map((b) => b._id);
    
            // Delete related bookings
            if (bookingIds.length > 0) {
              await bookingsCollection.deleteMany({ roomId: new ObjectId(id) });
            }
    
            // Delete room document
            await roomsCollection.deleteOne({ _id: new ObjectId(id) });
    
            res.json({ success: true, message: "Room deleted successfully" });
          } catch (error) {
            console.error("Delete Room Error:", error);
            res.status(500).json({ message: "Failed to delete room" });
          }
        });
    

    app.get("/", (req, res) => {
      res.send("StudyNook Server API is running smoothly!");
    });
    
    app.post("/api/bookings", authMiddleware, async (req, res) => {
          try {
            const { roomId, date, startTime, endTime, specialNote } = req.body;
    
            if (!roomId || !date || !startTime || !endTime) {
              return res.status(400).json({ message: "Room, date, start time, and end time are required." });
            }
    
            if (!ObjectId.isValid(roomId)) {
              return res.status(400).json({ message: "Invalid Room ID" });
            }
    
            let room = await roomsCollection.findOne({ _id: new ObjectId(roomId) });
            if (!room) {
              room = await defaultRoomsCollection.findOne({ _id: new ObjectId(roomId) });
            }
            if (!room) {
              return res.status(404).json({ message: "Room not found" });
            }
    
            // Validate time
            const startHour = parseInt(startTime.split(":")[0]);
            const endHour = parseInt(endTime.split(":")[0]);
    
            if (isNaN(startHour) || isNaN(endHour) || endHour <= startHour) {
              return res.status(400).json({ message: "End time must be after start time." });
            }
    
            // Double-booking Conflict Check:
            // Find existing confirmed bookings for this room on the given date
            const existingBookings = await bookingsCollection
              .find({
                roomId: new ObjectId(roomId),
                date: date,
                status: "confirmed",
              })
              .toArray();
    
            // Conflict condition: newStart < existEnd AND newEnd > existStart
            const hasConflict = existingBookings.some((b) => {
              const bStart = parseInt(b.startTime.split(":")[0]);
              const bEnd = parseInt(b.endTime.split(":")[0]);
              return startHour < bEnd && endHour > bStart;
            });
    
            if (hasConflict) {
              return res.status(409).json({
                message: "Conflict: This room is already booked for the selected time slot.",
              });
            }
    
            const totalHours = endHour - startHour;
            const totalCost = totalHours * room.hourlyRate;
    
            const newBooking = {
              roomId: new ObjectId(roomId),
              userId: req.user.id,
              userName: req.user.name,
              userEmail: req.user.email,
              date,
              startTime,
              endTime,
              totalCost,
              specialNote: specialNote || "",
              status: "confirmed",
              createdAt: new Date(),
            };
    
            const result = await bookingsCollection.insertOne(newBooking);
            const bookingId = result.insertedId;
    
            // Increment room booking count
            await roomsCollection.updateOne(
              { _id: new ObjectId(roomId) },
              { $inc: { bookingCount: 1 } }
            );
    
            res.status(201).json({
              success: true,
              message: "Room booked successfully!",
              booking: { _id: bookingId, ...newBooking },
            });
          } catch (error) {
            console.error("Booking Error:", error);
            res.status(500).json({ message: "Failed to create booking" });
          }
        });

    app.listen(port, () => {
      console.log(`StudyNook backend server listening on port ${port}`);
    });
  } catch (err) {
    console.error("MongoDB Connection Failed:", err);
  }
}

run().catch(console.dir);
