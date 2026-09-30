require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { SignJWT, jwtVerify } = require("jose-cjs");

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

// Authentication Middleware with JWT verification (jose-cjs) and Session fallback
const authMiddleware = async (req, res, next) => {
  // 1. Check for JWT token in Cookies or Bearer Authorization header
  const token =
    req.cookies?.token ||
    req.cookies?.jwt_token ||
    (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null);

  if (token) {
    try {
      const decoded = await verifyJwtToken(token);
      req.user = {
        id: decoded.id || decoded.userId || decoded._id,
        email: decoded.email,
        name: decoded.name,
        photoURL: decoded.photoURL || decoded.image,
      };
      return next();
    } catch (err) {
      console.warn("JWT verification error (jose-cjs), checking session fallback:", err.message);
    }
  }

  // 2. Fallback: Validate Better Auth session token
  const betterAuthToken =
    req.cookies?.["better-auth.session_token"] ||
    req.cookies?.["__Secure-better-auth.session_token"] ||
    req.headers["x-better-auth-token"];

  if (!betterAuthToken) {
    return res.status(401).json({ message: "Unauthorized access: Token missing or expired" });
  }

  try {
    const db = client.db("studynook_db");
    const session = await db.collection("session").findOne({
      token: betterAuthToken,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return res.status(401).json({ message: "Unauthorized access: Invalid or expired session" });
    }

    let u = null;
    try {
      u = await db.collection("user").findOne({ _id: new ObjectId(session.userId) });
    } catch {
      u = await db.collection("user").findOne({ id: session.userId });
    }
    if (!u) {
      u = await db.collection("user").findOne({ _id: session.userId });
    }

    if (!u) {
      return res.status(401).json({ message: "Unauthorized access: User not found" });
    }

    req.user = {
      id: u._id?.toString() || u.id,
      email: u.email,
      name: u.name,
      photoURL: u.image,
    };
    return next();
  } catch (e) {
    console.error("Auth session validation error:", e);
    return res.status(401).json({ message: "Unauthorized access: Session error" });
  }
};

async function run() {
  try {
    await client.connect();
    console.log("Connected successfully to MongoDB!");

    const db = client.db("studynook_db");
    const roomsCollection = db.collection("rooms");
    const bookingsCollection = db.collection("bookings");
    const defaultRoomsCollection = db.collection("default_rooms");

    // Automatically load from MongoDB Atlas 'default_rooms' collection if 'rooms' is ever empty
    const roomCount = await roomsCollection.countDocuments();
    if (roomCount === 0) {
      const defaultDocs = await defaultRoomsCollection.find().toArray();
      if (defaultDocs.length > 0) {
        const cleanDocs = defaultDocs.map(({ _id, ...rest }) => ({
          ...rest,
          createdAt: rest.createdAt || new Date(),
        }));
        await roomsCollection.insertMany(cleanDocs);
        console.log("Successfully populated rooms from MongoDB Atlas default_rooms collection!");
      }
    }

    // Helper to issue JWT token (via jose-cjs) and set cookie visible in DevTools -> Application -> Cookies
    const issueJwtAndSetCookie = async (res, payload) => {
      const token = await signJwtToken(payload);
      res.cookie("token", token, {
        httpOnly: false, // Visible in Application -> Cookies & document.cookie
        secure: false, // Allows development over HTTP
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: "/",
      });
      return token;
    };

    // JWT Token Generation Route (Identifies individual user & sets cookie via jose-cjs)
    const handleJwtRoute = async (req, res) => {
      try {
        const { id, email, name, photoURL, image } = req.body || {};
        if (!email) {
          return res.status(400).json({ message: "Email is required to generate JWT token" });
        }

        const payload = {
          id: id || email,
          email: email.toLowerCase(),
          name: name || "User",
          photoURL: photoURL || image || "",
        };

        const token = await issueJwtAndSetCookie(res, payload);

        return res.json({
          success: true,
          message: "JWT token generated via jose-cjs and stored in cookie successfully",
          token,
          user: payload,
        });
      } catch (error) {
        console.error("JWT creation error:", error);
        return res.status(500).json({ message: "Failed to generate JWT token" });
      }
    };

    app.post("/api/jwt", handleJwtRoute);
    app.post("/jwt", handleJwtRoute);
    app.post("/api/auth/jwt", handleJwtRoute);

    // Get current user profile & refresh JWT cookie
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

    app.post("/api/auth/logout", handleLogout);
    app.post("/logout", handleLogout);

    // ROOMS ROUTES

    // Get all rooms (with Search & Filter & Limit & Sort)
    app.get("/api/rooms", async (req, res) => {
      try {
        const { search, amenities, floor, minRate, maxRate, sort, limit } = req.query;

        const query = {};

        // Search by room name
        if (search && search.trim() !== "") {
          query.name = { $regex: search.trim(), $options: "i" };
        }

        // Filter by amenities ($in operator)
        if (amenities) {
          const amenitiesList = Array.isArray(amenities)
            ? amenities
            : amenities.split(",").map((a) => a.trim()).filter(Boolean);
          if (amenitiesList.length > 0) {
            query.amenities = { $in: amenitiesList };
          }
        }

        // Filter by floor
        if (floor && floor !== "all") {
          query.floor = { $regex: floor, $options: "i" };
        }

        // Filter by price ($gte, $lte)
        if (minRate || maxRate) {
          query.hourlyRate = {};
          if (minRate) query.hourlyRate.$gte = Number(minRate);
          if (maxRate) query.hourlyRate.$lte = Number(maxRate);
        }

        // Sorting
        let sortOption = { createdAt: -1 };
        if (sort === "price-asc") {
          sortOption = { hourlyRate: 1 };
        } else if (sort === "price-desc") {
          sortOption = { hourlyRate: -1 };
        } else if (sort === "popular") {
          sortOption = { bookingCount: -1 };
        }

        let cursor = roomsCollection.find(query).sort(sortOption);

        if (limit) {
          cursor = cursor.limit(parseInt(limit));
        }

        const rooms = await cursor.toArray();
        res.json(rooms);
      } catch (error) {
        console.error("Get Rooms Error:", error);
        res.status(500).json({ message: "Failed to fetch study rooms" });
      }
    });

    // Get my listings (Owner)
    app.get("/api/rooms/user/me", authMiddleware, async (req, res) => {
      try {
        const rooms = await roomsCollection
          .find({ ownerId: req.user.id })
          .sort({ createdAt: -1 })
          .toArray();
        res.json(rooms);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch user listings" });
      }
    });

    // Get all default rooms directly from MongoDB Atlas default_rooms collection
    app.get("/api/default-rooms", async (req, res) => {
      try {
        const defaultRooms = await defaultRoomsCollection.find().toArray();
        res.json(defaultRooms);
      } catch (error) {
        console.error("Fetch default rooms error:", error);
        res.status(500).json({ message: "Failed to fetch default rooms" });
      }
    });

    // Get single room details (from rooms or default_rooms)
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

    // Update room (Owner only check)
    app.put("/api/rooms/:id", authMiddleware, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Room ID" });
        }

        const existingRoom = await roomsCollection.findOne({ _id: new ObjectId(id) });
        if (!existingRoom) {
          return res.status(404).json({ message: "Room not found" });
        }

        if (existingRoom.ownerId !== req.user.id) {
          return res.status(403).json({ message: "Forbidden: You can only edit your own rooms." });
        }

        const { name, description, image, floor, capacity, hourlyRate, amenities } = req.body;

        const updateDoc = {
          $set: {
            name: name || existingRoom.name,
            description: description || existingRoom.description,
            image: image || existingRoom.image,
            floor: floor ? String(floor) : existingRoom.floor,
            capacity: capacity ? Number(capacity) : existingRoom.capacity,
            hourlyRate: hourlyRate ? Number(hourlyRate) : existingRoom.hourlyRate,
            amenities: Array.isArray(amenities) ? amenities : existingRoom.amenities,
            updatedAt: new Date(),
          },
        };

        await roomsCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
        const updatedRoom = await roomsCollection.findOne({ _id: new ObjectId(id) });

        res.json({
          success: true,
          message: "Room updated successfully",
          room: updatedRoom,
        });
      } catch (error) {
        console.error("Update Room Error:", error);
        res.status(500).json({ message: "Failed to update study room" });
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

    // BOOKING SYSTEM ROUTES

    // Book a Room (Private + Time Conflict Detection + $push to user bookings array)
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

    // Get My Bookings (Private + populated room data)
    app.get("/api/bookings/my", authMiddleware, async (req, res) => {
      try {
        const bookings = await bookingsCollection
          .find({ userId: req.user.id, status: { $ne: "cancelled" } })
          .sort({ createdAt: -1 })
          .toArray();

        // Populate room details for each booking
        const populatedBookings = await Promise.all(
          bookings.map(async (b) => {
            let room = await roomsCollection.findOne({ _id: b.roomId });
            if (!room) {
              room = await defaultRoomsCollection.findOne({ _id: b.roomId });
            }
            return {
              ...b,
              room: room
                ? {
                  id: room._id,
                  name: room.name,
                  image: room.image,
                  floor: room.floor,
                  hourlyRate: room.hourlyRate,
                }
                : null,
            };
          })
        );

        res.json(populatedBookings);
      } catch (error) {
        console.error("Get Bookings Error:", error);
        res.status(500).json({ message: "Failed to fetch user bookings" });
      }
    });

    // Cancel Booking (Private + removes booking completely + decrements count + $pull from user)
    const handleCancelAction = async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid Booking ID" });
        }

        const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
        if (!booking) {
          return res.status(404).json({ message: "Booking not found" });
        }

        if (booking.userId !== req.user.id) {
          return res.status(403).json({ message: "Forbidden: You can only cancel your own bookings." });
        }


        // Decrement room booking count if room exists
        if (booking.roomId) {
          await roomsCollection.updateOne(
            { _id: new ObjectId(booking.roomId), bookingCount: { $gt: 0 } },
            { $inc: { bookingCount: -1 } }
          );
        }

        // Delete the booking record completely so it never shows in /my-bookings
        await bookingsCollection.deleteOne({ _id: new ObjectId(id) });

        res.json({ success: true, message: "Booking cancelled and removed successfully" });
      } catch (error) {
        console.error("Cancel Booking Error:", error);
        res.status(500).json({ message: "Failed to cancel booking" });
      }
    };

    app.patch("/api/bookings/:id/cancel", authMiddleware, handleCancelAction);
    app.delete("/api/bookings/:id", authMiddleware, handleCancelAction);

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
