const PORT = process.env.PORT || 5000;
const cors = require('cors');

// Update CORS configuration
app.use(cors({
    origin: ['http://localhost:3000', 'https://your-frontend-url.com'],
    credentials: true
}));

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 