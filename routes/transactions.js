const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Récupérer toutes les transactions de l'utilisateur
router.get('/', async (req, res) => {
  try {
    const db = admin.firestore();
    const { type, category, startDate, endDate, limit = 50 } = req.query;

    // Requête simple sans orderBy pour éviter les index composites
    const snapshot = await db.collection('transactions')
      .where('userId', '==', req.user.userId)
      .get();

    let transactions = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Filtrer côté serveur
      if (type && type !== 'all' && data.type !== type) return;
      if (category && category !== 'all' && data.category !== category) return;
      
      // Convertir la date
      let transDate;
      if (data.date && data.date.toDate) {
        transDate = data.date.toDate();
      } else if (data.date) {
        transDate = new Date(data.date);
      } else {
        transDate = new Date();
      }
      
      // Filtrer par date si nécessaire
      if (startDate && startDate !== 'null' && transDate < new Date(startDate)) return;
      if (endDate && endDate !== 'null' && transDate > new Date(endDate)) return;
      
      transactions.push({
        id: doc.id,
        ...data,
        date: transDate.toISOString()
      });
    });

    // Trier par date décroissante côté serveur
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Limiter le nombre de résultats
    transactions = transactions.slice(0, parseInt(limit));

    res.json({ transactions });
  } catch (error) {
    console.error('Erreur récupération transactions:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des transactions' });
  }
});

// Créer une transaction
router.post('/', async (req, res) => {
  try {
    const { type, amount, category, description, date } = req.body;

    if (!type || !amount || !category) {
      return res.status(400).json({ error: 'Type, montant et catégorie requis' });
    }

    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'Type doit être "income" ou "expense"' });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Le montant doit être positif' });
    }

    const db = admin.firestore();
    const transactionRef = await db.collection('transactions').add({
      userId: req.user.userId,
      type,
      amount: parseFloat(amount),
      category,
      description: description || '',
      date: date ? admin.firestore.Timestamp.fromDate(new Date(date)) : admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const newTransaction = await transactionRef.get();
    const data = newTransaction.data();

    let transDate;
    if (data.date && data.date.toDate) {
      transDate = data.date.toDate();
    } else {
      transDate = new Date();
    }

    res.status(201).json({
      message: 'Transaction créée avec succès',
      transaction: {
        id: transactionRef.id,
        ...data,
        date: transDate.toISOString()
      }
    });
  } catch (error) {
    console.error('Erreur création transaction:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la transaction' });
  }
});

// Modifier une transaction
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount, category, description, date } = req.body;

    const db = admin.firestore();
    const transactionRef = db.collection('transactions').doc(id);
    const transactionDoc = await transactionRef.get();

    if (!transactionDoc.exists) {
      return res.status(404).json({ error: 'Transaction non trouvée' });
    }

    if (transactionDoc.data().userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (type) updateData.type = type;
    if (amount) updateData.amount = parseFloat(amount);
    if (category) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (date) updateData.date = admin.firestore.Timestamp.fromDate(new Date(date));

    await transactionRef.update(updateData);

    const updated = await transactionRef.get();
    const data = updated.data();

    let transDate;
    if (data.date && data.date.toDate) {
      transDate = data.date.toDate();
    } else {
      transDate = new Date();
    }

    res.json({
      message: 'Transaction modifiée avec succès',
      transaction: {
        id,
        ...data,
        date: transDate.toISOString()
      }
    });
  } catch (error) {
    console.error('Erreur modification transaction:', error);
    res.status(500).json({ error: 'Erreur lors de la modification de la transaction' });
  }
});

// Supprimer une transaction
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const db = admin.firestore();
    const transactionRef = db.collection('transactions').doc(id);
    const transactionDoc = await transactionRef.get();

    if (!transactionDoc.exists) {
      return res.status(404).json({ error: 'Transaction non trouvée' });
    }

    if (transactionDoc.data().userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    await transactionRef.delete();

    res.json({ message: 'Transaction supprimée avec succès' });
  } catch (error) {
    console.error('Erreur suppression transaction:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de la transaction' });
  }
});

// Récupérer les catégories utilisées
router.get('/categories', async (req, res) => {
  try {
    const db = admin.firestore();
    const snapshot = await db.collection('transactions')
      .where('userId', '==', req.user.userId)
      .get();

    const categories = new Set();
    snapshot.forEach(doc => {
      categories.add(doc.data().category);
    });

    // Catégories par défaut
    const defaultCategories = {
      income: ['Salaire', 'Freelance', 'Investissements', 'Cadeaux', 'Autres revenus'],
      expense: ['Alimentation', 'Transport', 'Logement', 'Santé', 'Loisirs', 'Shopping', 'Factures', 'Éducation', 'Autres dépenses']
    };

    res.json({
      userCategories: Array.from(categories),
      defaultCategories
    });
  } catch (error) {
    console.error('Erreur récupération catégories:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des catégories' });
  }
});

module.exports = router;
