import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:fairway_sniper/models/booking_job.dart';
import 'package:fairway_sniper/models/booking_run.dart';

class FirebaseService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;

  User? get currentUser => _auth.currentUser;
  String? get currentUserId => _auth.currentUser?.uid;

  Future<String?> getFCMToken() async {
    try {
      await _messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      return await _messaging.getToken();
    } catch (e) {
      return null;
    }
  }

  Future<UserCredential> signInWithEmail(String email, String password) async {
    final credential = await _auth.signInWithEmailAndPassword(email: email, password: password);
    
    // Ensure user profile exists (for existing users created before profile system)
    final userDoc = await _firestore.collection('users').doc(credential.user!.uid).get();
    if (!userDoc.exists) {
      await _firestore.collection('users').doc(credential.user!.uid).set({
        'email': email,
        'created_at': Timestamp.now(),
        'updated_at': Timestamp.now(),
        'isAdmin': false,
      });
    }
    
    return credential;
  }

  Future<UserCredential> signUpWithEmail(String email, String password) async {
    final credential = await _auth.createUserWithEmailAndPassword(email: email, password: password);
    
    // Create user profile document
    await _firestore.collection('users').doc(credential.user!.uid).set({
      'email': email,
      'created_at': Timestamp.now(),
      'updated_at': Timestamp.now(),
      'isAdmin': false,
    });
    
    return credential;
  }
  
  Future<bool> isAdmin(String userId) async {
    try {
      final doc = await _firestore.collection('users').doc(userId).get();
      return doc.data()?['isAdmin'] == true;
    } catch (e) {
      return false;
    }
  }
  
  Stream<bool> isAdminStream(String userId) {
    return _firestore
        .collection('users')
        .doc(userId)
        .snapshots()
        .map((doc) => doc.data()?['isAdmin'] == true);
  }

  Future<void> signOut() async {
    await _auth.signOut();
  }

  Stream<List<BookingJob>> getUserJobs(String userId) {
    return _firestore
        .collection('jobs')
        .where('ownerUid', isEqualTo: userId)
        .orderBy('created_at', descending: true)
        .snapshots()
        .handleError((error) {
          print('Error loading jobs: $error');
          return [];
        })
        .map((snapshot) => snapshot.docs.map((doc) => BookingJob.fromJson(doc.data(), doc.id)).toList());
  }

  Future<String> createJob(BookingJob job) async {
    print('🔵 FirebaseService.createJob called');
    print('🔵 Job data: ${job.toJson()}');
    
    try {
      final docRef = await _firestore.collection('jobs').add(job.toJson());
      print('✅ Job document created with ID: ${docRef.id}');
      return docRef.id;
    } catch (e, stackTrace) {
      print('❌ Error in createJob: $e');
      print('❌ Stack trace: $stackTrace');
      rethrow;
    }
  }

  Future<void> updateJob(String jobId, Map<String, dynamic> data) async {
    data['updated_at'] = Timestamp.now();
    await _firestore.collection('jobs').doc(jobId).update(data);
  }

  Future<void> deleteJob(String jobId) async {
    await _firestore.collection('jobs').doc(jobId).delete();
  }

  Stream<List<BookingRun>> getJobRuns(String jobId) {
    return _firestore
        .collection('runs')
        .where('jobId', isEqualTo: jobId)
        .orderBy('started_utc', descending: true)
        .limit(20)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((doc) => BookingRun.fromJson(doc.data(), doc.id)).toList());
  }

  Stream<List<BookingRun>> getAllUserRuns(String userId) async* {
    try {
      final jobs = await _firestore
          .collection('jobs')
          .where('ownerUid', isEqualTo: userId)
          .get();
      
      if (jobs.docs.isEmpty) {
        yield [];
        return;
      }

      final jobIds = jobs.docs.map((doc) => doc.id).toList();
      
      yield* _firestore
          .collection('runs')
          .where('jobId', whereIn: jobIds)
          .orderBy('started_utc', descending: true)
          .limit(50)
          .snapshots()
          .handleError((error) {
            print('Error loading runs: $error');
            return [];
          })
          .map((snapshot) => snapshot.docs.map((doc) => BookingRun.fromJson(doc.data(), doc.id)).toList());
    } catch (e) {
      print('Error in getAllUserRuns: $e');
      yield [];
    }
  }
}
