const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
        })
    });
}

const db = admin.firestore();

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const batchesSnap = await db.collection('batches').orderBy('createdAt', 'desc').get();
            const ordersSnap = await db.collection('orders').orderBy('createdAt', 'desc').get();

            const batches = batchesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const orders = ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            return res.status(200).json({ success: true, batches, orders });
        }

        if (req.method === 'POST') {
            const { type, batchCode, orderId, status } = req.body;

            if (type === 'UPDATE_BATCH') {
                await db.collection('batches').doc(batchCode).update({ status });
                return res.status(200).json({ success: true });
            }

            if (type === 'UPDATE_ORDER') {
                await db.collection('orders').doc(orderId).update({ status });
                return res.status(200).json({ success: true });
            }
        }

        return res.status(400).json({ error: 'طلب غير صالح' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
