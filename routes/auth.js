const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

const JWT_SECRET = process.env.JWT_SECRET || 'e-coris-secret-key-2024';
const JWT_EXPIRES_IN = '7d';

// Inscription
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, mot de passe et nom complet requis' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    const db = admin.firestore();
    
    // Vérifier si l'utilisateur existe déjà
    const existingUser = await db.collection('users').where('email', '==', email.toLowerCase()).get();
    if (!existingUser.empty) {
      return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 12);

    // Créer l'utilisateur
    const userRef = await db.collection('users').add({
      email: email.toLowerCase(),
      password: hashedPassword,
      fullName,
      hasFormationAccess: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Générer le token
    const token = jwt.sign(
      { userId: userRef.id, email: email.toLowerCase() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      message: 'Compte créé avec succès',
      token,
      user: {
        id: userRef.id,
        email: email.toLowerCase(),
        fullName,
        hasFormationAccess: false
      }
    });
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

// Inscription avec accès formation (après achat)
router.post('/register-formation', async (req, res) => {
  try {
    const { email, password, fullName, purchaseCode } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const db = admin.firestore();

    // Vérifier le code d'achat si fourni
    let validPurchase = false;
    if (purchaseCode) {
      const purchaseRef = await db.collection('purchases').where('code', '==', purchaseCode).where('used', '==', false).get();
      if (!purchaseRef.empty) {
        validPurchase = true;
        // Marquer le code comme utilisé
        await purchaseRef.docs[0].ref.update({ used: true, usedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await db.collection('users').where('email', '==', email.toLowerCase()).get();
    if (!existingUser.empty) {
      // Si l'utilisateur existe et a un code valide, activer la formation
      if (validPurchase) {
        await existingUser.docs[0].ref.update({ 
          hasFormationAccess: true,
          formationActivatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return res.json({ message: 'Accès formation activé pour votre compte existant' });
      }
      return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const userRef = await db.collection('users').add({
      email: email.toLowerCase(),
      password: hashedPassword,
      fullName,
      hasFormationAccess: validPurchase,
      formationActivatedAt: validPurchase ? admin.firestore.FieldValue.serverTimestamp() : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const token = jwt.sign(
      { userId: userRef.id, email: email.toLowerCase() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      message: validPurchase ? 'Compte créé avec accès formation' : 'Compte créé avec succès',
      token,
      user: {
        id: userRef.id,
        email: email.toLowerCase(),
        fullName,
        hasFormationAccess: validPurchase
      }
    });
  } catch (error) {
    console.error('Erreur inscription formation:', error);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

// Connexion
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const db = admin.firestore();
    const userSnapshot = await db.collection('users').where('email', '==', email.toLowerCase()).get();

    if (userSnapshot.empty) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    const validPassword = await bcrypt.compare(password, userData.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const token = jwt.sign(
      { userId: userDoc.id, email: userData.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Mettre à jour la dernière connexion
    await userDoc.ref.update({
      lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      message: 'Connexion réussie',
      token,
      user: {
        id: userDoc.id,
        email: userData.email,
        fullName: userData.fullName,
        hasFormationAccess: userData.hasFormationAccess || false
      }
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

// Vérifier le token / Récupérer le profil
router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(req.user.userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();
    res.json({
      user: {
        id: userDoc.id,
        email: userData.email,
        fullName: userData.fullName,
        hasFormationAccess: userData.hasFormationAccess || false
      }
    });
  } catch (error) {
    console.error('Erreur profil:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du profil' });
  }
});

// Activer un code de formation
router.post('/activate', require('../middleware/auth'), async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Code d\'activation requis' });
    }

    const db = admin.firestore();

    // Vérifier le code d'achat
    const purchaseRef = await db.collection('purchases')
      .where('code', '==', code.trim().toUpperCase())
      .where('used', '==', false)
      .get();

    if (purchaseRef.empty) {
      return res.status(400).json({ error: 'Code invalide ou déjà utilisé' });
    }

    // Marquer le code comme utilisé
    await purchaseRef.docs[0].ref.update({ 
      used: true, 
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      usedBy: req.user.userId
    });

    // Activer la formation pour l'utilisateur
    await db.collection('users').doc(req.user.userId).update({
      hasFormationAccess: true,
      formationActivatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ 
      success: true,
      message: 'Formation activée avec succès' 
    });
  } catch (error) {
    console.error('Erreur activation:', error);
    res.status(500).json({ error: 'Erreur lors de l\'activation' });
  }
});

module.exports = router;
