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
    final credential = await _auth.signInWithEmailAndPassword(
        email: email, password: password);

    // Ensure user profile exists (for existing users created before profile system)
    final userDoc =
        await _firestore.collection('users').doc(credential.user!.uid).get();
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

  Future<UserCredential> signUpWithEmail(String email, String password,
      {String? displayName}) async {
    final credential = await _auth.createUserWithEmailAndPassword(
        email: email, password: password);

    if (displayName != null && displayName.trim().isNotEmpty) {
      await credential.user!.updateDisplayName(displayName.trim());
    }

    // Create user profile document
    await _firestore.collection('users').doc(credential.user!.uid).set({
      'email': email,
      'name': displayName?.trim() ?? credential.user!.displayName,
      'created_at': Timestamp.now(),
      'updated_at': Timestamp.now(),
      'isAdmin': false,
    });

    return credential;
  }

  Future<String?> getUserDisplayName(String userId) async {
    try {
      final doc = await _firestore.collection('users').doc(userId).get();
      if (!doc.exists) return null;
      final data = doc.data();
      final name = data?['name'] as String?;
      if (name != null && name.trim().isNotEmpty) return name.trim();
      // Fallback to auth profile
      return _auth.currentUser?.displayName;
    } catch (e) {
      return null;
    }
  }

  Future<void> updateUserName(String userId, String name) async {
    try {
      final trimmed = name.trim();
      await _firestore.collection('users').doc(userId).set({
        'name': trimmed,
        'updated_at': Timestamp.now(),
      }, SetOptions(merge: true));
      if (_auth.currentUser?.uid == userId) {
        await _auth.currentUser!.updateDisplayName(trimmed);
      }
    } catch (e) {
      rethrow;
    }
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
    }).map((snapshot) => snapshot.docs
            .map((doc) => BookingJob.fromJson(doc.data(), doc.id))
            .toList());
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
        .map((snapshot) => snapshot.docs
            .map((doc) => BookingRun.fromJson(doc.data(), doc.id))
            .toList());
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
      }).map((snapshot) => snapshot.docs
              .map((doc) => BookingRun.fromJson(doc.data(), doc.id))
              .toList());
    } catch (e) {
      print('Error in getAllUserRuns: $e');
      yield [];
    }
  }

  /// Fetch an optional list of available tee times for a given club from Firestore.
  ///
  /// Expected document path: `metadata/available_times/{club}` with a field
  /// `times` that is an array of strings like ["07:56","08:04",...].
  /// Returns an empty list when no document or field exists or on error.
  Future<List<String>> getAvailableTimes(String club) async {
    try {
      final doc =
          await _firestore.collection('metadata').doc('available_times').get();
      if (!doc.exists) return [];
      final data = doc.data() ?? {};
      final mapForClub = data[club] ?? data['times'] ?? null;
      if (mapForClub is List) {
        return mapForClub.map((e) => e.toString()).toList();
      }

      // Backwards-compatible: support document structured as
      // { "times": { "galgorm": ["07:56", ...] } }
      final nested = data['times'];
      if (nested is Map && nested[club] is List) {
        return (nested[club] as List).map((e) => e.toString()).toList();
      }

      return [];
    } catch (e) {
      print('Error fetching available times for $club: $e');
      return [];
    }
  }

  /// Save BRS credentials to user profile (encrypted in production, plain text for now)
  Future<void> saveBRSCredentials(
      String userId, String brsUsername, String brsPassword,
      {String? club}) async {
    try {
      final data = {
        'brs_username': brsUsername,
        'brs_password': brsPassword, // TODO: Encrypt in production
        'brs_credentials_updated_at': Timestamp.now(),
      };
      if (club != null) {
        data['brs_club'] = club;
      }
      await _firestore.collection('users').doc(userId).set(
          data,
          SetOptions(
              merge: true)); // Use merge to create doc if it doesn't exist
      print('✅ BRS credentials saved for user $userId');
    } catch (e) {
      print('❌ Error saving BRS credentials: $e');
      rethrow;
    }
  }

  /// Load BRS credentials from user profile
  Future<Map<String, String>?> loadBRSCredentials(String userId) async {
    try {
      final doc = await _firestore.collection('users').doc(userId).get();
      if (!doc.exists) return null;

      final data = doc.data();
      final username = data?['brs_username'] as String?;
      final password = data?['brs_password'] as String?;

      if (username != null && password != null) {
        return {'username': username, 'password': password};
      }
      return null;
    } catch (e) {
      print('❌ Error loading BRS credentials: $e');
      return null;
    }
  }

  /// Clear BRS credentials from user profile
  Future<void> clearBRSCredentials(String userId) async {
    try {
      await _firestore.collection('users').doc(userId).set({
        'brs_username': FieldValue.delete(),
        'brs_password': FieldValue.delete(),
        'brs_credentials_updated_at': FieldValue.delete(),
        'brs_club': FieldValue.delete(),
      }, SetOptions(merge: true));
      print('✅ BRS credentials cleared for user $userId');
    } catch (e) {
      print('❌ Error clearing BRS credentials: $e');
      rethrow;
    }
  }

  /// Get user's club GUI from profile
  Future<String?> getUserClubGUI(String userId) async {
    try {
      final doc = await _firestore.collection('users').doc(userId).get();
      if (!doc.exists) return null;
      return doc.data()?['brs_club'] as String?;
    } catch (e) {
      print('❌ Error loading club GUI: $e');
      return null;
    }
  }

  /// Save player directory to cache
  Future<void> savePlayerDirectory(
      String userId, dynamic playerDirectory) async {
    try {
      final data = playerDirectory.toFirestore();
      await _firestore
          .collection('users')
          .doc(userId)
          .collection('cache')
          .doc('playerDirectory')
          .set(data);
      print('✅ Player directory cached for user $userId');
    } catch (e) {
      print('❌ Error saving player directory: $e');
      rethrow;
    }
  }

  /// Load player directory from cache
  Future<dynamic> loadPlayerDirectory(String userId) async {
    try {
      final doc = await _firestore
          .collection('users')
          .doc(userId)
          .collection('cache')
          .doc('playerDirectory')
          .get();

      if (!doc.exists) return null;

      // Import PlayerDirectory here to avoid circular dependency
      // The caller should handle the conversion
      return doc.data();
    } catch (e) {
      print('❌ Error loading player directory: $e');
      return null;
    }
  }

  /// Clear player directory cache
  Future<void> clearPlayerDirectory(String userId) async {
    try {
      await _firestore
          .collection('users')
          .doc(userId)
          .collection('cache')
          .doc('playerDirectory')
          .delete();
      print('✅ Player directory cache cleared for user $userId');
    } catch (e) {
      print('❌ Error clearing player directory: $e');
      rethrow;
    }
  }
}
