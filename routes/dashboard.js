const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

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

    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', req.user.userId)
      .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .get();

    let totalIncome = 0;
    let totalExpense = 0;
    const expensesByCategory = {};
    const incomesByCategory = {};

    transactionsSnapshot.forEach(doc => {
      const { type, amount, category } = doc.data();
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
      summary: {
        totalIncome,
        totalExpense,
        balance,
        transactionCount: transactionsSnapshot.size
      },
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
    const trends = [];

    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);

      const snapshot = await db.collection('transactions')
        .where('userId', '==', req.user.userId)
        .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
        .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
        .get();

      let income = 0;
      let expense = 0;

      snapshot.forEach(doc => {
        const { type, amount } = doc.data();
        if (type === 'income') income += amount;
        else expense += amount;
      });

      trends.push({
        month: startDate.toLocaleString('fr-FR', { month: 'short', year: 'numeric' }),
        monthIndex: startDate.getMonth() + 1,
        year: startDate.getFullYear(),
        income,
        expense,
        balance: income - expense
      });
    }

    res.json({ trends });
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

    const snapshot = await db.collection('transactions')
      .where('userId', '==', req.user.userId)
      .orderBy('date', 'desc')
      .limit(parseInt(limit))
      .get();

    const transactions = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        ...data,
        date: data.date.toDate().toISOString()
      });
    });

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

    // Récupérer les budgets du mois
    const budgetsSnapshot = await db.collection('budgets')
      .where('userId', '==', req.user.userId)
      .where('month', '==', month)
      .where('year', '==', year)
      .get();

    if (budgetsSnapshot.empty) {
      return res.json({ alerts: [] });
    }

    // Calculer les dépenses du mois
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', req.user.userId)
      .where('type', '==', 'expense')
      .where('date', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('date', '<=', admin.firestore.Timestamp.fromDate(endDate))
      .get();

    const expensesByCategory = {};
    transactionsSnapshot.forEach(doc => {
      const { category, amount } = doc.data();
      expensesByCategory[category] = (expensesByCategory[category] || 0) + amount;
    });

    // Générer les alertes
    const alerts = [];
    budgetsSnapshot.forEach(doc => {
      const budget = doc.data();
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

    // Total de toutes les transactions
    const allTransactions = await db.collection('transactions')
      .where('userId', '==', req.user.userId)
      .get();

    let totalIncome = 0;
    let totalExpense = 0;
    let firstTransactionDate = null;

    allTransactions.forEach(doc => {
      const { type, amount, date } = doc.data();
      if (type === 'income') totalIncome += amount;
      else totalExpense += amount;

      const transDate = date.toDate();
      if (!firstTransactionDate || transDate < firstTransactionDate) {
        firstTransactionDate = transDate;
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
        transactionCount: allTransactions.size,
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
