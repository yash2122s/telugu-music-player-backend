const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const mongoose = require('mongoose');
const Song = require('./models/Song');
const authMiddleware = require('./middleware/auth');
const fs = require('fs');
require('dotenv').config();

// Initialize express
const app = express();

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// CORS configuration - Place this BEFORE any routes
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://your-frontend-domain.com', // Add your frontend URL when you deploy it
        'https://telugu-music-player.onrender.com' // Add your Render URL when you get it
    ],
    credentials: true
}));

// Add this before your routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes - Place these BEFORE the static file middleware
app.get('/api/songs', authMiddleware, async (req, res) => {
    try {
        const songs = await Song.find().sort({ uploadDate: -1 });
        res.json(songs);
    } catch (error) {
        console.error('Error fetching songs:', error);
        res.status(500).json({ error: 'Error fetching songs' });
    }
});

app.post('/api/upload', authMiddleware, upload.fields([
    { name: 'songFile', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
]), async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.email !== 'admin@teluguyash.com') {
            return res.status(403).json({
                success: false,
                error: 'Only admin can upload songs'
            });
        }

        // Validate request
        if (!req.files?.songFile?.[0] || !req.files?.coverImage?.[0]) {
            return res.status(400).json({
                success: false,
                error: 'Both song file and cover image are required'
            });
        }

        if (!req.body.title || !req.body.artist) {
            return res.status(400).json({
                success: false,
                error: 'Title and artist are required'
            });
        }

        // Upload song to Cloudinary
        const songResult = await cloudinary.uploader.upload(req.files.songFile[0].path, {
            resource_type: 'auto',
            folder: 'songs'
        });

        // Upload cover to Cloudinary
        const coverResult = await cloudinary.uploader.upload(req.files.coverImage[0].path, {
            resource_type: 'image',
            folder: 'covers'
        });

        // Create new song in database
        const song = new Song({
            title: req.body.title,
            artist: req.body.artist,
            file: songResult.secure_url,
            cover: coverResult.secure_url,
            uploadDate: new Date()
        });

        await song.save();

        // Clean up temporary files
        fs.unlinkSync(req.files.songFile[0].path);
        fs.unlinkSync(req.files.coverImage[0].path);

        // Send success response
        res.status(200).json({
            success: true,
            message: 'Upload successful',
            song: song
        });

    } catch (error) {
        console.error('Upload error:', error);
        
        // Clean up temporary files if they exist
        if (req.files) {
            if (req.files.songFile?.[0]) fs.unlinkSync(req.files.songFile[0].path);
            if (req.files.coverImage?.[0]) fs.unlinkSync(req.files.coverImage[0].path);
        }

        res.status(500).json({
            success: false,
            error: error.message || 'Failed to upload song'
        });
    }
});

app.delete('/api/songs/:id', authMiddleware, async (req, res) => {
    try {
        // Get user from auth middleware
        const user = req.user;
        console.log('User attempting delete:', user); // Debug log

        // Check if user is admin
        if (user.email !== 'admin@teluguyash.com') {
            console.log('User not authorized:', user.email); // Debug log
            return res.status(403).json({ error: 'Only admin can delete songs' });
        }

        const songId = req.params.id;
        console.log('Attempting to delete song:', songId); // Debug log

        const song = await Song.findById(songId);
        if (!song) {
            return res.status(404).json({ error: 'Song not found' });
        }

        // Get Cloudinary public IDs
        const songPublicId = song.file.split('/').slice(-2).join('/').split('.')[0];
        const coverPublicId = song.cover.split('/').slice(-2).join('/').split('.')[0];
        
        console.log('Deleting from Cloudinary:', { songPublicId, coverPublicId }); // Debug log

        try {
            // Delete from Cloudinary with full path
            await Promise.all([
                cloudinary.uploader.destroy(songPublicId, { resource_type: 'video' }),
                cloudinary.uploader.destroy(coverPublicId)
            ]);
            console.log('Cloudinary files deleted successfully');
        } catch (cloudinaryError) {
            console.error('Cloudinary deletion error:', cloudinaryError);
            // Continue with MongoDB deletion even if Cloudinary fails
        }

        // Delete from MongoDB
        await Song.findByIdAndDelete(songId);
        console.log('Song deleted from MongoDB successfully');

        res.json({ message: 'Song deleted successfully' });
    } catch (error) {
        console.error('Error deleting song:', error);
        res.status(500).json({ error: error.message || 'Failed to delete song' });
    }
});

// Update song route
app.put('/api/songs/:id', authMiddleware, upload.single('coverImage'), async (req, res) => {
    try {
        console.log('Update request received for song:', req.params.id);
        console.log('Request body:', req.body);
        console.log('File:', req.file);

        // Check if user is admin
        if (req.user.email !== 'admin@teluguyash.com') {
            return res.status(403).json({ error: 'Only admin can edit songs' });
        }

        const songId = req.params.id;
        const song = await Song.findById(songId);
        
        if (!song) {
            return res.status(404).json({ error: 'Song not found' });
        }

        // Update basic details
        if (req.body.title) song.title = req.body.title;
        if (req.body.artist) song.artist = req.body.artist;

        // If new cover image is uploaded
        if (req.file) {
            try {
                // Extract the public ID from the old cover URL
                const oldCoverUrl = song.cover;
                const urlParts = oldCoverUrl.split('/');
                const publicIdWithExtension = urlParts[urlParts.length - 1];
                const publicId = `covers/${publicIdWithExtension.split('.')[0]}`;
                
                console.log('Deleting old cover with public ID:', publicId);

                // Delete old cover from Cloudinary
                await cloudinary.uploader.destroy(publicId);

                // Upload new cover
                console.log('Uploading new cover...');
                const coverUpload = await cloudinary.uploader.upload(req.file.path, {
                    folder: 'covers',
                    resource_type: 'image'
                });

                // Update song cover URL
                song.cover = coverUpload.secure_url;
                console.log('New cover URL:', song.cover);

                // Clean up uploaded file
                fs.unlinkSync(req.file.path);
            } catch (cloudinaryError) {
                console.error('Cloudinary error:', cloudinaryError);
                return res.status(500).json({ error: 'Failed to update cover image' });
            }
        }

        // Save updated song
        const updatedSong = await song.save();
        console.log('Song updated successfully:', updatedSong);
        
        res.json(updatedSong);
    } catch (error) {
        console.error('Error updating song:', error);
        res.status(500).json({ error: error.message || 'Failed to update song' });
    }
});

// Add this test route near your other routes
app.get('/api/test', (req, res) => {
    res.json({ 
        message: "Server is running!", 
        timestamp: new Date(),
        status: "OK"
    });
});

// Serve static files - Place this AFTER the API routes
app.use(express.static(path.join(__dirname, '../Frontend')));

// Handle all other routes by serving index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('=================================');
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📝 Test the server: http://localhost:${PORT}/api/test`);
    console.log(`📚 MongoDB Status: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}`);
    console.log('=================================');
});

// Add this after MongoDB connection
async function cleanupTestSongs() {
    try {
        const testSongs = await Song.find({ 
            title: 'Test Song',
            artist: 'Test Artist'
        });

        if (testSongs.length > 0) {
            console.log('Cleaning up test songs...');
            
            // Delete test songs from MongoDB
            await Song.deleteMany({ 
                title: 'Test Song',
                artist: 'Test Artist'
            });

            console.log('Test songs cleaned up successfully');
        }
    } catch (error) {
        console.error('Error cleaning up test songs:', error);
    }
}

// Update MongoDB connection to include cleanup
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    // Add these options for better stability
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(async () => {
    console.log('Connected to MongoDB Atlas');
    await cleanupTestSongs();
    mongoose.connection.on('connected', () => {
        console.log('✅ MongoDB connected successfully');
    });

    mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
        console.log('❌ MongoDB disconnected');
    });
})
.catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
});

module.exports = app;
