const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const DATA_FILE = path.join(__dirname, 'events.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'eventflow-secret-key-2024';

// JWT Token middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Admin role check middleware
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

async function readEvents() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

async function writeEvents(events) {
  await fs.writeFile(DATA_FILE, JSON.stringify(events, null, 2), 'utf8');
}

app.get('/api/events', async (req, res) => {
  const events = await readEvents();
  res.json(events);
});

app.get('/api/events/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const events = await readEvents();
  const ev = events.find(e => e.id === id);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  res.json(ev);
});

app.post('/api/events', async (req, res) => {
  const events = await readEvents();
  const { title, date, time, category, location, description, capacity, banner, city } = req.body;
  if (!title || !date || !time || !category || !location || !city || !capacity) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const maxId = events.reduce((m, e) => Math.max(m, e.id || 0), 0);
  const normalizedCity = String(city).trim() || 'Unknown City';
  const newEvent = {
    id: maxId + 1,
    title,
    date,
    time,
    category,
    city: normalizedCity,
    location,
    description: description || '',
    capacity: parseInt(capacity, 10),
    attendees: 0,
    attending: false,
    banner: banner || ''
  };

  events.unshift(newEvent);
  await writeEvents(events);
  res.status(201).json(newEvent);
});

app.post('/api/events/:id/rsvp', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const events = await readEvents();
  const ev = events.find(e => e.id === id);
  if (!ev) return res.status(404).json({ error: 'Event not found' });

  if (ev.attendees >= ev.capacity) {
    return res.status(400).json({ error: 'Event at capacity' });
  }

  ev.attendees = (ev.attendees || 0) + 1;
  ev.attending = true;
  await writeEvents(events);
  res.json(ev);
});

// Delete event (Admin only)
app.delete('/api/events/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const events = await readEvents();
    const eventIndex = events.findIndex(e => e.id === id);
    
    if (eventIndex === -1) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    const deletedEvent = events.splice(eventIndex, 1);
    await writeEvents(events);
    res.json({ message: 'Event deleted successfully', deletedEvent: deletedEvent[0] });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// ==================== AUTHENTICATION ENDPOINTS ====================

// Read users from file
async function readUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// Write users to file
async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email, role } = req.body;
    
    if (!username || !password || !email) {
      return res.status(400).json({ error: 'Username, password, and email are required' });
    }

    const users = await readUsers();
    
    // Check if user already exists
    const existingUser = users.find(u => u.username === username || u.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Determine role (default: customer, only admin can create admin)
    const userRole = role || 'customer';

    const newUser = {
      id: users.length + 1,
      username,
      password: hashedPassword,
      email,
      role: userRole
    };

    users.push(newUser);
    await writeUsers(users);

    // Generate token
    const token = jwt.sign({ id: newUser.id, username: newUser.username, role: newUser.role }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const users = await readUsers();
    const user = users.find(u => u.username === username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user info
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  const users = await readUsers();
  const user = users.find(u => u.id === req.user.id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
});

// Check if user is admin (for frontend to determine UI)
app.get('/api/auth/is-admin', authenticateToken, (req, res) => {
  res.json({ isAdmin: req.user.role === 'admin' });
});

// Initialize default users if none exist
async function initializeDefaultUsers() {
  const users = await readUsers();
  if (users.length === 0) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const hashedCustomerPassword = await bcrypt.hash('customer123', 10);
    
    const defaultUsers = [
      { id: 1, username: 'admin', password: hashedPassword, email: 'admin@eventflow.com', role: 'admin' },
      { id: 2, username: 'customer', password: hashedCustomerPassword, email: 'customer@eventflow.com', role: 'customer' }
    ];
    
    await writeUsers(defaultUsers);
    console.log('Default users created: admin (password: admin123), customer (password: customer123)');
  }
}

// Initialize default users on startup
initializeDefaultUsers();

app.listen(PORT, () => {
  console.log(`EventFlow backend running on http://localhost:${PORT}`);
});
