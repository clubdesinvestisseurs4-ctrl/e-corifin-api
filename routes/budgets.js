const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Récupérer tous les budgets de l'utilisateur
router.get('/', async (req, res) => {
  try {
    const db = admin.firestore();
    const { month, year } = req.query;

    let query = db.collection('budgets')
      .where('userId', '==', req.user.userId);

    if (month && year) {
      query = query.where('month', '==', parseInt(month))
                   .where('year', '==', parseInt(year));
    }

    const snapshot = await query.get();

    const budgets = [];
    snapshot.forEach(doc => {
      budgets.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({ budgets });
  } catch (error) {
    console.error('Erreur récupération budgets:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des budgets' });
  }
});

// Créer un budget
router.post('/', async (req, res) => {
  try {
    const { category, amount, month, year } = req.body;

    if (!category || !amount || !month || !year) {
      return res.status(400).json({ error: 'Catégorie, montant, mois et année requis' });
    }

    const db = admin.firestore();

    // Vérifier si un budget existe déjà pour cette catégorie/période
    const existing = await db.collection('budgets')
      .where('userId', '==', req.user.userId)
      .where('category', '==', category)
      .where('month', '==', parseInt(month))
      .where('year', '==', parseInt(year))
      .get();

    if (!existing.empty) {
      return res.status(400).json({ error: 'Un budget existe déjà pour cette catégorie et période' });
    }

    const budgetRef = await db.collection('budgets').add({
      userId: req.user.userId,
      category,
      amount: parseFloat(amount),
      month: parseInt(month),
      year: parseInt(year),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const newBudget = await budgetRef.get();

    res.status(201).json({
      message: 'Budget créé avec succès',
      budget: {
        id: budgetRef.id,
        ...newBudget.data()
      }
    });
  } catch (error) {
    console.error('Erreur création budget:', error);
    res.status(500).json({ error: 'Erreur lors de la création du budget' });
  }
});

// Modifier un budget
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: 'Montant requis' });
    }

    const db = admin.firestore();
    const budgetRef = db.collection('budgets').doc(id);
    const budgetDoc = await budgetRef.get();

    if (!budgetDoc.exists) {
      return res.status(404).json({ error: 'Budget non trouvé' });
    }

    if (budgetDoc.data().userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    await budgetRef.update({
      amount: parseFloat(amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updated = await budgetRef.get();

    res.json({
      message: 'Budget modifié avec succès',
      budget: {
        id,
        ...updated.data()
      }
    });
  } catch (error) {
    console.error('Erreur modification budget:', error);
    res.status(500).json({ error: 'Erreur lors de la modification du budget' });
  }
});

// Supprimer un budget
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const db = admin.firestore();
    const budgetRef = db.collection('budgets').doc(id);
    const budgetDoc = await budgetRef.get();

    if (!budgetDoc.exists) {
      return res.status(404).json({ error: 'Budget non trouvé' });
    }

    if (budgetDoc.data().userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    await budgetRef.delete();

    res.json({ message: 'Budget supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression budget:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du budget' });
  }
});

// Récupérer le suivi des budgets (budget vs dépenses réelles)
router.get('/tracking', async (req, res) => {
  try {
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ error: 'Mois et année requis' });
    }

    const db = admin.firestore();

    // Récupérer les budgets du mois
    const budgetsSnapshot = await db.collection('budgets')
      .where('userId', '==', req.user.userId)
      .where('month', '==', parseInt(month))
      .where('year', '==', parseInt(year))
      .get();

    // Calculer les dates de début et fin du mois
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

    // Récupérer les dépenses du mois
    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', req.user.userId)
      .where('type', '==', 'expense')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .get();

    // Calculer les dépenses par catégorie
    const expensesByCategory = {};
    transactionsSnapshot.forEach(doc => {
      const { category, amount } = doc.data();
      expensesByCategory[category] = (expensesByCategory[category] || 0) + amount;
    });

    // Construire le suivi
    const tracking = [];
    budgetsSnapshot.forEach(doc => {
      const budget = doc.data();
      const spent = expensesByCategory[budget.category] || 0;
      const remaining = budget.amount - spent;
      const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

      tracking.push({
        id: doc.id,
        category: budget.category,
        budgeted: budget.amount,
        spent,
        remaining,
        percentage: Math.round(percentage * 100) / 100,
        status: percentage > 100 ? 'exceeded' : percentage > 80 ? 'warning' : 'ok'
      });
    });

    // Ajouter les catégories sans budget
    Object.keys(expensesByCategory).forEach(category => {
      if (!tracking.find(t => t.category === category)) {
        tracking.push({
          id: null,
          category,
          budgeted: 0,
          spent: expensesByCategory[category],
          remaining: -expensesByCategory[category],
          percentage: 100,
          status: 'no_budget'
        });
      }
    });

    res.json({ tracking });
  } catch (error) {
    console.error('Erreur suivi budgets:', error);
    res.status(500).json({ error: 'Erreur lors du suivi des budgets' });
  }
});

module.exports = router;
