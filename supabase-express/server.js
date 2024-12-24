const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// Supabase Initialization
const SUPABASE_URL = "https://ksjsudmdwrvqymbxdjpt.supabase.co";
const SUPABASE_SERVICE_ROLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzanN1ZG1kd3J2cXltYnhkanB0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNDkzMjExNiwiZXhwIjoyMDUwNTA4MTE2fQ.hl52kB4xthz7Aaf4kqvX_l3IHw720pFkw9HJpPRekQA"; // Replace with your Supabase service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the "uploads" folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Rename file to prevent conflict
  },
});

const upload = multer({ storage: storage });

// Unified Login/Signup Endpoint
app.post("/login", async (req, res) => {
  const { name, email, password, isSignup } = req.body;

  if (typeof isSignup === "undefined") {
    return res.status(400).json({ error: "isSignup is required and must be true or false." });
  }

  try {
    if (isSignup) {
      // Validate inputs
      if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required fields." });
      }
    
      // Signup logic
      const { data: signUpData, error: signUpError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Mark email as confirmed
        user_metadata: { name },
      });
    
      if (signUpError) {
        console.error("Supabase Signup Error:", JSON.stringify(signUpError, null, 2));
        return res.status(400).json({ error: signUpError.message });
      }
    
      // Insert user data into the 'login' table
      const { data: insertData, error: dbError } = await supabase
        .from("login") // Use the correct table name 'login'
        .insert([{ name, email }]); // Adjust fields if needed to match your 'login' table schema
    
      if (dbError) {
        console.error("Supabase DB Insert Error Details:", JSON.stringify(dbError, null, 2));
        return res.status(400).json({
          error: dbError.message || "Failed to insert user into database.",
          details: dbError,
        });
      }
    
      console.log("User inserted successfully into 'login' table:", insertData);
      res.status(201).json({ message: "User signed up successfully!", data: signUpData });
    }
    else {
      // Signin logic
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        console.error("Supabase Sign-in Error:", JSON.stringify(signInError, null, 2));
        return res.status(400).json({ error: signInError.message });
      }

      // Check if user is admin
      const isAdmin = email === "admin@gmail.com" && password === "admin123"; // Admin login check

      res.status(200).json({
        message: "User signed in successfully!",
        isAdmin, // Send isAdmin flag to frontend
        name: signInData.user.user_metadata.name,
      });
    }
  } catch (err) {
    console.error("Unexpected Error:", JSON.stringify(err, null, 2));
    res.status(500).json({ error: "Internal server error." });
  }
});



// Upload Article Route
app.post("/upload-article", upload.single("image"), async (req, res) => {
  const { title, content, category } = req.body;
  const imageFile = req.file;

  if (!title || !content || !category || !imageFile) {
    return res.status(400).json({ error: "All fields are required, including image." });
  }

  try {
    // Save image file locally in 'uploads' folder
    const imagePath = imageFile.filename;  // Save filename in DB

    // Insert article data into the 'blog' table
    const { data: articleData, error: dbError } = await supabase
      .from("blog") // Correct table name
      .insert([{
        title,
        content,
        category,
        image_url: imagePath, // Save image filename path in database
      }]);

    if (dbError) {
      console.error("Failed to insert article into database:", dbError);
      return res.status(400).json({ error: dbError.message });
    }

    res.status(201).json({ message: "Article uploaded successfully!", article: articleData });
  } catch (err) {
    console.error("Unexpected Error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Fetch Articles Route (with Category Filtering)
app.get("/articles", async (req, res) => {
  const { category } = req.query;

  try {
    const query = supabase.from("blog").select("*").order("created_at", { ascending: false });

    if (category) {
      query.eq("category", category);  // Filter by category
    }

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json({ articles: data });
  } catch (err) {
    console.error("Unexpected Error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Fetch Single Article by ID

app.get("/article/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("blog")
      .select("*")
      .eq("id", id)
      .single();  // Get a single article by ID

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json({ article: data });
  } catch (err) {
    console.error("Unexpected Error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Generate Article Content by ID
app.get("/generate-article/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data: article, error } = await supabase
      .from("blog")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !article) {
      return res.status(404).json({ error: "Article not found." });
    }

    // Generate dynamic content based on article data
    const generatedContent = `\n### Article: ${article.title}\n\n**Category**: ${article.category}\n\n${article.content}\n\n*Image*: /uploads/${article.image_url}`;

    res.status(200).json({ message: "Article content generated successfully!", generatedContent });
  } catch (err) {
    console.error("Unexpected Error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Serve Static Files (HTML, CSS, JS)
app.use(express.static("TB2"));

// Root Path
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/TB2/login.html");
});

// Start the Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
