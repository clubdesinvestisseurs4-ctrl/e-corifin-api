const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Helper: Convertir date Firestore en Date JS
function toJsDate(firestoreDate) {
  if (!firestoreDate) return new Date();
  if (firestoreDate.toDate) return firestoreDate.toDate();
  return new Date(firestoreDate);
}

// Récupérer tous les budgets de l'utilisateur
router.get('/', async (req, res) => {
  try {
    const db = admin.firestore();
    const { month, year } = req.query;

    // Requête simple sans filtres composites
    const snapshot = await db.collection('budgets')
      .where('userId', '==', req.user.userId)
      .get();

    const budgets = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Filtrer par mois/année côté serveur si demandé
      if (month && year) {
        if (data.month !== parseInt(month) || data.year !== parseInt(year)) {
          return;
        }
      }
      
      budgets.push({
        id: doc.id,
        ...data
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

    // Vérifier si un budget existe déjà - requête simple + filtrage serveur
    const allBudgets = await db.collection('budgets')
      .where('userId', '==', req.user.userId)
      .get();

    let exists = false;
    allBudgets.forEach(doc => {
      const data = doc.data();
      if (data.category === category && 
          data.month === parseInt(month) && 
          data.year === parseInt(year)) {
        exists = true;
      }
    });

    if (exists) {
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
    const monthInt = parseInt(month);
    const yearInt = parseInt(year);

    // Récupérer tous les budgets de l'utilisateur
    const allBudgets = await db.collection('budgets')
      .where('userId', '==', req.user.userId)
      .get();

    // Filtrer par mois/année côté serveur
    const budgets = [];
    allBudgets.forEach(doc => {
      const data = doc.data();
      if (data.month === monthInt && data.year === yearInt) {
        budgets.push({ id: doc.id, ...data });
      }
    });

    // Calculer les dates de début et fin du mois
    const startDate = new Date(yearInt, monthInt - 1, 1);
    const endDate = new Date(yearInt, monthInt, 0, 23, 59, 59);

    // Récupérer TOUTES les transactions de l'utilisateur (requête simple)
    const allTransactions = await db.collection('transactions')
      .where('userId', '==', req.user.userId)
      .get();

    // Filtrer côté serveur: type=expense et dans la période
    const expensesByCategory = {};
    allTransactions.forEach(doc => {
      const data = doc.data();
      
      // Filtrer par type
      if (data.type !== 'expense') return;
      
      // Filtrer par date
      const transDate = toJsDate(data.date);
      if (transDate < startDate || transDate > endDate) return;
      
      // Agréger par catégorie
      expensesByCategory[data.category] = (expensesByCategory[data.category] || 0) + data.amount;
    });

    // Construire le suivi avec les dépenses calculées
    const tracking = budgets.map(budget => {
      const spent = expensesByCategory[budget.category] || 0;
      const remaining = budget.amount - spent;
      const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

      return {
        id: budget.id,
        category: budget.category,
        amount: budget.amount,
        spent,
        remaining,
        percentage: Math.round(percentage),
        status: percentage > 100 ? 'exceeded' : percentage > 80 ? 'warning' : 'ok'
      };
    });

    res.json({ budgets: tracking });
  } catch (error) {
    console.error('Erreur suivi budgets:', error);
    res.status(500).json({ error: 'Erreur lors du suivi des budgets' });
  }
});

module.exports = router;
