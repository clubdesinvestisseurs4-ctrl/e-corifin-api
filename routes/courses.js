const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Middleware pour vérifier l'accès à la formation
const checkFormationAccess = async (req, res, next) => {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(req.user.userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    if (!userDoc.data().hasFormationAccess) {
      return res.status(403).json({ 
        error: 'Accès à la formation non autorisé',
        message: 'Vous devez acheter la formation pour accéder à ce contenu'
      });
    }

    next();
  } catch (error) {
    console.error('Erreur vérification accès formation:', error);
    res.status(500).json({ error: 'Erreur de vérification d\'accès' });
  }
};

// Vérifier le statut d'accès à la formation
router.get('/access-status', async (req, res) => {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(req.user.userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const userData = userDoc.data();
    res.json({
      hasAccess: userData.hasFormationAccess || false,
      activatedAt: userData.formationActivatedAt ? userData.formationActivatedAt.toDate().toISOString() : null
    });
  } catch (error) {
    console.error('Erreur vérification statut:', error);
    res.status(500).json({ error: 'Erreur lors de la vérification du statut' });
  }
});

// Récupérer tous les chapitres (structure)
router.get('/chapters', checkFormationAccess, async (req, res) => {
  try {
    const db = admin.firestore();
    const chaptersSnapshot = await db.collection('courses')
      .orderBy('order', 'asc')
      .get();

    const chapters = [];
    for (const doc of chaptersSnapshot.docs) {
      const chapterData = doc.data();
      
      // Récupérer le nombre de leçons pour chaque chapitre
      const lessonsCount = await db.collection('lessons')
        .where('courseId', '==', doc.id)
        .get();

      // Récupérer la progression de l'utilisateur pour ce chapitre
      const progressSnapshot = await db.collection('userProgress')
        .where('userId', '==', req.user.userId)
        .where('courseId', '==', doc.id)
        .get();

      const completedLessons = progressSnapshot.size;

      chapters.push({
        id: doc.id,
        title: chapterData.title,
        description: chapterData.description,
        order: chapterData.order,
        lessonsCount: lessonsCount.size,
        completedLessons,
        progress: lessonsCount.size > 0 ? Math.round((completedLessons / lessonsCount.size) * 100) : 0
      });
    }

    res.json({ chapters });
  } catch (error) {
    console.error('Erreur récupération chapitres:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des chapitres' });
  }
});

// Récupérer les leçons d'un chapitre
router.get('/chapters/:chapterId/lessons', checkFormationAccess, async (req, res) => {
  try {
    const { chapterId } = req.params;

    const db = admin.firestore();

    // Vérifier que le chapitre existe
    const chapterDoc = await db.collection('courses').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return res.status(404).json({ error: 'Chapitre non trouvé' });
    }

    // Récupérer les leçons
    const lessonsSnapshot = await db.collection('lessons')
      .where('courseId', '==', chapterId)
      .orderBy('order', 'asc')
      .get();

    // Récupérer la progression de l'utilisateur
    const progressSnapshot = await db.collection('userProgress')
      .where('userId', '==', req.user.userId)
      .where('courseId', '==', chapterId)
      .get();

    const completedLessonIds = new Set();
    progressSnapshot.forEach(doc => {
      completedLessonIds.add(doc.data().lessonId);
    });

    const lessons = [];
    lessonsSnapshot.forEach(doc => {
      const lessonData = doc.data();
      lessons.push({
        id: doc.id,
        title: lessonData.title,
        description: lessonData.description,
        order: lessonData.order,
        duration: lessonData.duration,
        completed: completedLessonIds.has(doc.id)
      });
    });

    res.json({
      chapter: {
        id: chapterId,
        title: chapterDoc.data().title,
        description: chapterDoc.data().description
      },
      lessons
    });
  } catch (error) {
    console.error('Erreur récupération leçons:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des leçons' });
  }
});

// Récupérer le contenu d'une leçon
router.get('/lessons/:lessonId', checkFormationAccess, async (req, res) => {
  try {
    const { lessonId } = req.params;

    const db = admin.firestore();
    const lessonDoc = await db.collection('lessons').doc(lessonId).get();

    if (!lessonDoc.exists) {
      return res.status(404).json({ error: 'Leçon non trouvée' });
    }

    const lessonData = lessonDoc.data();

    // Vérifier si la leçon est complétée
    const progressSnapshot = await db.collection('userProgress')
      .where('userId', '==', req.user.userId)
      .where('lessonId', '==', lessonId)
      .get();

    // Récupérer les leçons précédente et suivante
    const allLessons = await db.collection('lessons')
      .where('courseId', '==', lessonData.courseId)
      .orderBy('order', 'asc')
      .get();

    let prevLesson = null;
    let nextLesson = null;
    let currentIndex = -1;

    allLessons.forEach((doc, index) => {
      if (doc.id === lessonId) {
        currentIndex = index;
      }
    });

    if (currentIndex > 0) {
      const prevDoc = allLessons.docs[currentIndex - 1];
      prevLesson = { id: prevDoc.id, title: prevDoc.data().title };
    }

    if (currentIndex < allLessons.size - 1) {
      const nextDoc = allLessons.docs[currentIndex + 1];
      nextLesson = { id: nextDoc.id, title: nextDoc.data().title };
    }

    res.json({
      lesson: {
        id: lessonId,
        title: lessonData.title,
        description: lessonData.description,
        content: lessonData.content,
        videoUrl: lessonData.videoUrl,
        duration: lessonData.duration,
        order: lessonData.order,
        completed: !progressSnapshot.empty
      },
      navigation: {
        previous: prevLesson,
        next: nextLesson
      }
    });
  } catch (error) {
    console.error('Erreur récupération leçon:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de la leçon' });
  }
});

// Marquer une leçon comme complétée
router.post('/lessons/:lessonId/complete', checkFormationAccess, async (req, res) => {
  try {
    const { lessonId } = req.params;

    const db = admin.firestore();

    // Vérifier que la leçon existe
    const lessonDoc = await db.collection('lessons').doc(lessonId).get();
    if (!lessonDoc.exists) {
      return res.status(404).json({ error: 'Leçon non trouvée' });
    }

    // Vérifier si déjà complété
    const existingProgress = await db.collection('userProgress')
      .where('userId', '==', req.user.userId)
      .where('lessonId', '==', lessonId)
      .get();

    if (!existingProgress.empty) {
      return res.json({ message: 'Leçon déjà marquée comme complétée' });
    }

    // Créer l'entrée de progression
    await db.collection('userProgress').add({
      userId: req.user.userId,
      lessonId,
      courseId: lessonDoc.data().courseId,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ message: 'Leçon marquée comme complétée' });
  } catch (error) {
    console.error('Erreur marquage leçon:', error);
    res.status(500).json({ error: 'Erreur lors du marquage de la leçon' });
  }
});

// Récupérer la progression globale
router.get('/progress', checkFormationAccess, async (req, res) => {
  try {
    const db = admin.firestore();

    // Total des leçons
    const totalLessons = await db.collection('lessons').get();
    
    // Leçons complétées par l'utilisateur
    const completedLessons = await db.collection('userProgress')
      .where('userId', '==', req.user.userId)
      .get();

    const progress = totalLessons.size > 0 
      ? Math.round((completedLessons.size / totalLessons.size) * 100) 
      : 0;

    res.json({
      totalLessons: totalLessons.size,
      completedLessons: completedLessons.size,
      progress
    });
  } catch (error) {
    console.error('Erreur récupération progression:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de la progression' });
  }
});

module.exports = router;
