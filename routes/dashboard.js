const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Helper: Convertir date Firestore en Date JS
function toJsDate(firestoreDate) {
  if (!firestoreDate) return new Date();
  if (firestoreDate.toDate) return firestoreDate.toDate();
  return new Date(firestoreDate);
}

// Helper: Récupérer toutes les transactions d'un utilisateur
async function getUserTransactions(db, userId) {
  const snapshot = await db.collection('transactions')
    .where('userId', '==', userId)
    .get();
  
  const transactions = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    transactions.push({
      id: doc.id,
      ...data,
      date: toJsDate(data.date)
    });
  });
  
  return transactions;
}

// Récupérer le résumé financier
router.get('/summary', async (req, res) => {
  try {
    const { month, year } = req.query;
    const db = admin.firestore();

    let startDate, endDate;

    if (month && year) {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
    } else {
      // Par défaut: mois en cours
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    // Récupérer toutes les transactions et filtrer côté serveur
    const allTransactions = await getUserTransactions(db, req.user.userId);
    
    let totalIncome = 0;
    let totalExpense = 0;
    const expensesByCategory = {};
    const incomesByCategory = {};
    let transactionCount = 0;

    allTransactions.forEach(trans => {
      // Filtrer par date
      if (trans.date < startDate || trans.date > endDate) return;
      
      transactionCount++;
      const { type, amount, category } = trans;
      
      if (type === 'income') {
        totalIncome += amount;
        incomesByCategory[category] = (incomesByCategory[category] || 0) + amount;
      } else {
        totalExpense += amount;
        expensesByCategory[category] = (expensesByCategory[category] || 0) + amount;
      }
    });

    const balance = totalIncome - totalExpense;

    res.json({
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      },
      totalIncome,
      totalExpense,
      balance,
      transactionCount,
      breakdown: {
        expensesByCategory,
        incomesByCategory
      }
    });
  } catch (error) {
    console.error('Erreur résumé dashboard:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du résumé' });
  }
});

// Récupérer l'évolution sur plusieurs mois
router.get('/trend', async (req, res) => {
  try {
    const { months = 6 } = req.query;
    const db = admin.firestore();
    const now = new Date();

    // Récupérer toutes les transactions une seule fois
    const allTransactions = await getUserTransactions(db, req.user.userId);

    const data = [];

    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);

      let income = 0;
      let expense = 0;

      // Filtrer côté serveur
      allTransactions.forEach(trans => {
        if (trans.date < startDate || trans.date > endDate) return;
        
        if (trans.type === 'income') income += trans.amount;
        else expense += trans.amount;
      });

      data.push({
        month: startDate.getMonth() + 1,
        year: startDate.getFullYear(),
        income,
        expense,
        balance: income - expense
      });
    }

    res.json({ data });
  } catch (error) {
    console.error('Erreur tendances:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des tendances' });
  }
});

// Récupérer les transactions récentes
router.get('/recent', async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const db = admin.firestore();

    // Récupérer toutes les transactions
    const allTransactions = await getUserTransactions(db, req.user.userId);

    // Trier par date décroissante et limiter
    const transactions = allTransactions
      .sort((a, b) => b.date - a.date)
      .slice(0, parseInt(limit))
      .map(t => ({
        ...t,
        date: t.date.toISOString()
      }));

    res.json({ transactions });
  } catch (error) {
    console.error('Erreur transactions récentes:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des transactions récentes' });
  }
});

// Récupérer les alertes budget
router.get('/alerts', async (req, res) => {
  try {
    const db = admin.firestore();
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // Récupérer les budgets du mois (requête simple)
    const budgetsSnapshot = await db.collection('budgets')
      .where('userId', '==', req.user.userId)
      .get();
    
    // Filtrer par mois/année côté serveur
    const budgets = [];
    budgetsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.month === month && data.year === year) {
        budgets.push({ id: doc.id, ...data });
      }
    });

    if (budgets.length === 0) {
      return res.json({ alerts: [] });
    }

    // Récupérer toutes les transactions et filtrer
    const allTransactions = await getUserTransactions(db, req.user.userId);
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const expensesByCategory = {};
    allTransactions.forEach(trans => {
      if (trans.type !== 'expense') return;
      if (trans.date < startDate || trans.date > endDate) return;
      
      expensesByCategory[trans.category] = (expensesByCategory[trans.category] || 0) + trans.amount;
    });

    // Générer les alertes
    const alerts = [];
    budgets.forEach(budget => {
      const spent = expensesByCategory[budget.category] || 0;
      const percentage = (spent / budget.amount) * 100;

      if (percentage >= 100) {
        alerts.push({
          type: 'danger',
          category: budget.category,
          message: `Budget dépassé ! ${spent.toLocaleString('fr-FR')} FCFA / ${budget.amount.toLocaleString('fr-FR')} FCFA`,
          percentage: Math.round(percentage)
        });
      } else if (percentage >= 80) {
        alerts.push({
          type: 'warning',
          category: budget.category,
          message: `Attention: ${Math.round(percentage)}% du budget utilisé`,
          percentage: Math.round(percentage)
        });
      }
    });

    res.json({ alerts });
  } catch (error) {
    console.error('Erreur alertes:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des alertes' });
  }
});

// Statistiques globales
router.get('/stats', async (req, res) => {
  try {
    const db = admin.firestore();

    // Récupérer toutes les transactions
    const allTransactions = await getUserTransactions(db, req.user.userId);

    let totalIncome = 0;
    let totalExpense = 0;
    let firstTransactionDate = null;

    allTransactions.forEach(trans => {
      if (trans.type === 'income') totalIncome += trans.amount;
      else totalExpense += trans.amount;

      if (!firstTransactionDate || trans.date < firstTransactionDate) {
        firstTransactionDate = trans.date;
      }
    });

    // Calcul de l'épargne moyenne mensuelle
    let monthsTracked = 1;
    if (firstTransactionDate) {
      const now = new Date();
      monthsTracked = Math.max(1, 
        (now.getFullYear() - firstTransactionDate.getFullYear()) * 12 + 
        (now.getMonth() - firstTransactionDate.getMonth()) + 1
      );
    }

    const avgMonthlySavings = (totalIncome - totalExpense) / monthsTracked;

    res.json({
      stats: {
        totalIncome,
        totalExpense,
        totalSavings: totalIncome - totalExpense,
        transactionCount: allTransactions.length,
        monthsTracked,
        avgMonthlySavings: Math.round(avgMonthlySavings),
        savingsRate: totalIncome > 0 ? Math.round(((totalIncome - totalExpense) / totalIncome) * 100) : 0
      }
    });
  } catch (error) {
    console.error('Erreur statistiques:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

module.exports = router;
