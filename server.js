const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const ONE_HOUR_IN_MS = 60 * 60 * 1000;


app.use(cors());

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

queueSchema.pre('deleteOne', { document: true, query: false }, async function() {
  const deletedOrder = this.order;
  await this.model('Queue').updateMany(
    { order: { $gt: deletedOrder } },
    { $inc: { order: -1 } }
  );
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

app.put('/api/queues/:id', authMiddleware, async (req, res) => {
  try {
    const queueId = req.params.id;
    const { order: newOrder, name, type, status } = req.body;

    // 1. หาคิวที่จะแก้ไข
    const originalQueue = await Queue.findById(queueId);
    if (!originalQueue) {
      return res.status(404).json('Error: Queue not found');
    }

    const oldOrder = originalQueue.order;
    const oldStatus = originalQueue.status;

    // 2. จัดการ autoDeleteAt เมื่อเปลี่ยนสถานะ
    if (status === 'เสร็จสิ้น' && oldStatus !== 'เสร็จสิ้น') {
      // ตั้งเวลาลบใน 1 ชั่วโมงถ้าปรับเป็นสถานะ "เสร็จสิ้น"
      originalQueue.autoDeleteAt = new Date(Date.now() + ONE_HOUR_IN_MS); 
    } else if (status !== 'เสร็จสิ้น' && oldStatus === 'เสร็จสิ้น') {
      // ยกเลิกการลบอัตโนมัติถ้าเปลี่ยนออกจากสถานะ "เสร็จสิ้น"
      originalQueue.autoDeleteAt = null;
    }

    // 3. อัปเดตข้อมูลพื้นฐาน
    originalQueue.name = name;
    originalQueue.type = type;
    originalQueue.status = status;
    await originalQueue.save();

    // 4. หากมีการเปลี่ยน order
    if (newOrder !== oldOrder) {
      // ย้ายคิวอื่นๆ ให้เหมาะสม
      if (newOrder < oldOrder) {
        // กรณีย้ายขึ้น (เช่น จาก 3 เป็น 1)
        await Queue.updateMany(
          { 
            order: { $gte: newOrder, $lt: oldOrder },
            _id: { $ne: queueId }
          },
          { $inc: { order: 1 } }
        );
      } else {
        // กรณีย้ายลง (เช่น จาก 1 เป็น 3)
        await Queue.updateMany(
          { 
            order: { $gt: oldOrder, $lte: newOrder },
            _id: { $ne: queueId }
          },
          { $inc: { order: -1 } }
        );
      }

      // อัปเดต order ของคิวนี้
      await Queue.findByIdAndUpdate(queueId, { order: newOrder });
    }

    // 5. ส่งข้อมูลทั้งหมดกลับหลังอัปเดต
    const updatedQueues = await Queue.find().sort({ order: 1 });
    res.json(updatedQueues);

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
    await Queue.updateMany(
      { order: { $gt: deletedQueue.order } },
      { $inc: { order: -1 } }
    );

    const updatedQueues = await Queue.find().sort({ order: 1 });

    res.json(updatedQueues);

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

connection.once('open', () => {
  console.log("MongoDB database connection established successfully");
  
  if (mongoose.connection.readyState === 1) { // ถ้าเชื่อมต่อแล้ว
    const queueChangeStream = Queue.watch([], { fullDocument: 'updateLookup' });
    
    queueChangeStream.on('change', async (change) => {
      if (change.operationType === 'delete') {
        const deletedOrder = change.documentKey.order;
        await Queue.updateMany(
          { order: { $gt: deletedOrder } },
          { $inc: { order: -1 } }
        );
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});