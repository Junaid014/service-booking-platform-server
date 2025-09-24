const express = require('express');
const router = express.Router();
const twilio = require('twilio');
require('dotenv').config();
const jwt = require('jsonwebtoken');

// OTP generate function
function generateOtp(length = 6) {
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += Math.floor(Math.random() * 10);
  }
  return otp;
}

// ================== Send OTP ==================
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ message: "Phone is required" });

  const otp = generateOtp();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  const authDb = req.app.locals.authDb;

  authDb.run(
    `INSERT INTO otps (phone, otp, expiresAt) VALUES (?, ?, ?)`,
    [phone, otp, expiresAt],
    async (err) => {
      if (err) return res.status(500).json({ message: "Failed to save OTP" });

      try {
        await twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
          .messages.create({
            body: `Your OTP code is ${otp}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
          });
        res.json({ message: "OTP sent successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to send OTP" });
      }
    }
  );
});

// ================== Verify OTP ==================   <-- Step 6
router.post('/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ message: "Phone and OTP required" });

  const authDb = req.app.locals.authDb;
  const usersCollection = req.app.locals.usersCollection;

  authDb.get(
    `SELECT * FROM otps WHERE phone = ? ORDER BY id DESC LIMIT 1`,
    [phone],
    (err, row) => {
      if (err) return res.status(500).json({ message: "DB error" });
      if (!row) return res.status(400).json({ message: "OTP not found" });

      if (row.expiresAt < Date.now()) return res.status(400).json({ message: "OTP expired" });
      if (row.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });

      // OTP valid → JWT generate
      usersCollection.findOne({ phone }, (err, user) => {
        if (err) return res.status(500).json({ message: "MongoDB error" });

        const payload = {
          id: user?._id?.toString() || null,
          phone,
          role: user?.role || "customer"
        };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.json({ message: "OTP verified successfully", token, user: payload });
      });
    }
  );
});

module.exports = router;
