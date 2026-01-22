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
    
    // Récupérer tous les cours (chapitres)
    const chaptersSnapshot = await db.collection('courses').get();

    // Récupérer toutes les leçons
    const lessonsSnapshot = await db.collection('lessons').get();
    
    // Récupérer la progression de l'utilisateur
    const progressSnapshot = await db.collection('userProgress')
      .where('userId', '==', req.user.userId)
      .get();

    // Mapper les leçons par courseId
    const lessonsByCourse = {};
    lessonsSnapshot.forEach(doc => {
      const data = doc.data();
      if (!lessonsByCourse[data.courseId]) {
        lessonsByCourse[data.courseId] = [];
      }
      lessonsByCourse[data.courseId].push(doc.id);
    });

    // Mapper les leçons complétées par courseId
    const completedByCourse = {};
    progressSnapshot.forEach(doc => {
      const data = doc.data();
      if (!completedByCourse[data.courseId]) {
        completedByCourse[data.courseId] = 0;
      }
      completedByCourse[data.courseId]++;
    });

    // Construire la liste des chapitres
    const chapters = [];
    chaptersSnapshot.forEach(doc => {
      const chapterData = doc.data();
      const lessonsCount = lessonsByCourse[doc.id] ? lessonsByCourse[doc.id].length : 0;
      const completedLessons = completedByCourse[doc.id] || 0;

      chapters.push({
        id: doc.id,
        title: chapterData.title,
        description: chapterData.description,
        order: chapterData.order || 0,
        progress: {
          total: lessonsCount,
          completed: completedLessons
        }
      });
    });

    // Trier par order côté serveur
    chapters.sort((a, b) => a.order - b.order);

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

    // Récupérer TOUTES les leçons (requête simple)
    const lessonsSnapshot = await db.collection('lessons').get();

    // Filtrer par courseId côté serveur
    const lessons = [];
    lessonsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.courseId === chapterId) {
        lessons.push({
          id: doc.id,
          title: data.title,
          description: data.description,
          order: data.order || 0,
          duration: data.duration,
          completed: false // sera mis à jour après
        });
      }
    });

    // Trier par order côté serveur
    lessons.sort((a, b) => a.order - b.order);

    // Récupérer la progression de l'utilisateur pour ce chapitre
    const progressSnapshot = await db.collection('userProgress')
      .where('userId', '==', req.user.userId)
      .get();

    // Marquer les leçons complétées
    const completedLessonIds = new Set();
    progressSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.courseId === chapterId) {
        completedLessonIds.add(data.lessonId);
      }
    });

    lessons.forEach(lesson => {
      lesson.completed = completedLessonIds.has(lesson.id);
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
      .get();

    let isCompleted = false;
    progressSnapshot.forEach(doc => {
      if (doc.data().lessonId === lessonId) {
        isCompleted = true;
      }
    });

    // Récupérer toutes les leçons du même chapitre pour la navigation
    const allLessonsSnapshot = await db.collection('lessons').get();
    
    const courseLessons = [];
    allLessonsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.courseId === lessonData.courseId) {
        courseLessons.push({
          id: doc.id,
          order: data.order || 0,
          title: data.title
        });
      }
    });

    // Trier par order
    courseLessons.sort((a, b) => a.order - b.order);

    // Trouver la position actuelle
    let currentIndex = courseLessons.findIndex(l => l.id === lessonId);
    let prevLesson = currentIndex > 0 ? courseLessons[currentIndex - 1] : null;
    let nextLesson = currentIndex < courseLessons.length - 1 ? courseLessons[currentIndex + 1] : null;

    res.json({
      lesson: {
        id: lessonId,
        title: lessonData.title,
        description: lessonData.description,
        content: lessonData.content,
        videoUrl: lessonData.videoUrl,
        duration: lessonData.duration,
        order: lessonData.order,
        completed: isCompleted
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
      .get();

    let alreadyCompleted = false;
    existingProgress.forEach(doc => {
      if (doc.data().lessonId === lessonId) {
        alreadyCompleted = true;
      }
    });

    if (alreadyCompleted) {
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

    const total = totalLessons.size;
    const completed = completedLessons.size;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.json({
      totalLessons: total,
      completedLessons: completed,
      progress
    });
  } catch (error) {
    console.error('Erreur récupération progression:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de la progression' });
  }
});

module.exports = router;
