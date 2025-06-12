const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
});
const User = mongoose.model('User', userSchema);

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected for seeding...');

    const adminEmail = 'zentstudio.zt@gmail.com'; // ใช้อีเมลจริง
    const adminPassword = 'plBfNXFIUZCFKWe'; // ตั้งรหัสผ่าน

    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('Admin user already exists.');
      mongoose.connection.close();
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    const newAdmin = new User({
      email: adminEmail,
      password: hashedPassword,
    });

    await newAdmin.save();
    console.log('Admin user created successfully!');

    mongoose.connection.close();

  } catch (error) {
    console.error('Error seeding admin user:', error);
    process.exit(1);
  }
};

createAdmin();