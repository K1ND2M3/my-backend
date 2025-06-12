const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;


const corsOptions = {
  origin: [
    'http://localhost:3000', // สำหรับตอนพัฒนา
    'https://queue-app-zeta.vercel.app/' // << ใส่ URL ที่ได้จาก Vercel
  ]
};
app.use(cors(corsOptions));

app.use(express.json());


const uri = process.env.MONGO_URI;
mongoose.connect(uri);

const connection = mongoose.connection;
connection.once('open', () => {
  console.log("MongoDB database connection established successfully");
});


const queueSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  name: { type: String, required: true },
  type: { type: String, required: true },
  status: { type: String, required: true },
  createdAt: { type: String, required: true },
  autoDeleteAt: { type: Date, default: null }
}, {
  timestamps: true,
});

queueSchema.index({ autoDeleteAt: 1 }, { expireAfterSeconds: 0 });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
});

const User = mongoose.model('User', userSchema);

const Queue = mongoose.model('Queue', queueSchema);
const authMiddleware = require('./middleware/authMiddleware');

app.get('/api/queues', async (req, res) => {
  try {
    const queues = await Queue.find().sort({ order: 1 });
    res.json(queues);
  } catch (err) {
    res.status(400).json('Error: ' + err);
  }
});


app.post('/api/queues' , authMiddleware, async (req, res) => {
  try {
    const {name, type} = req.body;

    if (!name || !type) {
      return res.status(400).json('Error: Please provide name and type.');
    }

    const lastQueue = await Queue.findOne().sort({ order: -1 });
    const newOrder = lastQueue ? lastQueue.order + 1 : 1;

    const newQueue = new Queue({
      name,
      type,
      order: newOrder,
      status: 'รอดำเนินการ',
      createdAt: new Date().toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    });

    const savedQueue = await newQueue.save();
    res.status(201).json(savedQueue);
  } catch (err) {
    res.status(400).json('Error: ' + err);
  }
});

app.put('/api/queues/:id', authMiddleware, async (req,res) => {
  try {
    const queueId = req.params.id;
    const { order: newOrder, name, type, status } = req.body;

    const originalQueue = await Queue.findById(queueId);
    if (!originalQueue) {
      return res.status(404).json('Error: Queue not found');
    }
    const oldOrder = originalQueue.order;
    const oldStatus = originalQueue.status;

    let autoDeleteUpdate = {};
    const ONE_HOUR_IN_MS = 60 * 60 * 1000;

    if (status === 'เสร็จสิ้น' && oldStatus !== 'เสร็จสิ้น') {
      autoDeleteUpdate.autoDeleteAt = new Date(Date.now() + ONE_HOUR_IN_MS);
    }

    else if (status !== 'เสร็จสิ้น' && oldStatus === 'เสร็จสิ้น') {
      autoDeleteUpdate.autoDeleteAt = null;
    }

    originalQueue.name = name;
    originalQueue.type = type;
    originalQueue.status = status;
    if (autoDeleteUpdate.hasOwnProperty('autoDeleteAt')) {
      originalQueue.autoDeleteAt = autoDeleteUpdate.autoDeleteAt;
    }
    await originalQueue.save();

    if (newOrder !== oldOrder) {
      if (newOrder > oldOrder) {
        await Queue.updateMany(
          { order: {$gt: oldOrder, $lte: newOrder }},
          { $inc: { order: -1 }}
        );
      }

      if (newOrder < oldOrder) {
        await Queue.updateMany(
          { order: { $gte: newOrder, $lt: oldOrder }},
          { $inc: { order: 1 }}
        );
      }

      await Queue.findByIdAndUpdate(queueId, { order: newOrder });
    }

    res.json('Queue updated successfully.');

  } catch (err) {
    res.status(400).json('Error: ' + err);
  }
});


app.delete('/api/queues/:id', authMiddleware, async (req, res) => {
  try {
    const deletedQueue = await Queue.findByIdAndDelete(req.params.id);
    if (!deletedQueue) {
      return res.status(404).json('Error: Queue not found');
    }
    res.json({ message: 'Queue deleted successfully.' });
  } catch (err) {
    res.status(400).json('Error: ' + err);
  }
});


app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }

    const payload = { user: { id: user.id, role: user.role } };
    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );

  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});