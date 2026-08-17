import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart' show Firebase;
import 'package:google_fonts/google_fonts.dart';
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/services/booking_prefetch_service.dart';
import 'package:fairway_sniper/services/agent_base_url.dart';
import 'package:fairway_sniper/services/safe_proof_builder.dart';
import 'package:fairway_sniper/services/safe_proof_status.dart';
import 'package:fairway_sniper/services/sniper_job_status.dart';
import 'package:fairway_sniper/services/weather_service.dart';
import 'package:fairway_sniper/services/golf_news_service.dart';
import 'package:fairway_sniper/models/booking_job.dart';
import 'package:fairway_sniper/models/booking_run.dart';
import 'package:fairway_sniper/screens/mode_selection_screen.dart';
import 'package:fairway_sniper/screens/admin_dashboard.dart';
import 'package:fairway_sniper/screens/course_info_screen.dart';
import 'package:fairway_sniper/widgets/brs_credentials_modal.dart';
import 'package:fairway_sniper/widgets/dashboard_widgets.dart';
import 'package:fairway_sniper/theme/app_spacing.dart';
import 'package:intl/intl.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'dart:convert';
import 'dart:async';
import 'package:fairway_sniper/theme.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _firebaseService = FirebaseService();
  late final BookingPrefetchService _prefetchService;
  final _weatherService = WeatherService();
  final _golfNewsService = GolfNewsService();
  final _newsScrollController = ScrollController();
  Map<String, dynamic>? _currentWeather;
  Map<String, dynamic>? _weatherForecast;
  List<Map<String, dynamic>>? _newsArticles;
  bool _isDarkMode = false;
  String? _displayName;
  Map<String, String>? _savedCreds;
  bool _loadingCreds = false;
  bool _proofRunning = false;
  String? _proofJobId;
  String? _proofStatusMessage;
  StreamSubscription<Map<String, dynamic>?>? _proofWatchSub;

  @override
  void initState() {
    super.initState();
    _prefetchService =
        BookingPrefetchService(firebaseService: _firebaseService);
    _loadWeather();
    _loadNews();
    _loadProfile();
    _prefetchService.run();
  }

  @override
  void dispose() {
    _proofWatchSub?.cancel();
    _newsScrollController.dispose();
    super.dispose();
  }

  Future<void> _loadWeather() async {
    final current = await _weatherService.getCurrentWeather();
    final nextSaturday = _getNextSaturday();
    final forecast = await _weatherService.getWeatherForecast(nextSaturday);
    if (mounted) {
      setState(() {
        _currentWeather = current;
        _weatherForecast = forecast;
      });
    }
  }

  Future<void> _loadNews() async {
    final news = await _golfNewsService.getGolfNews();
    if (mounted) setState(() => _newsArticles = news);
  }

  Future<void> _loadProfile() async {
    final userId = _firebaseService.currentUserId;
    if (userId == null) return;
    setState(() => _loadingCreds = true);
    final creds = await _firebaseService.loadBRSCredentials(userId);
    final name = await _firebaseService.getUserDisplayName(userId);
    if (!mounted) return;
    setState(() {
      _savedCreds = creds;
      _displayName = name ?? _firebaseService.currentUser?.displayName;
      _loadingCreds = false;
    });
  }

  Future<void> _editSavedCreds() async {
    final uid = _firebaseService.currentUserId;
    if (uid == null) return;

    final result = await showBRSCredentialsModal(
      context,
      initialUsername: _savedCreds?['username'],
      initialPassword: _savedCreds?['password'],
      title: 'Edit Saved BRS Login',
    );

    if (result != null) {
      await _firebaseService.saveBRSCredentials(
          uid, result['username']!, result['password']!);
      if (!mounted) return;
      setState(() => _savedCreds = result);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Saved BRS login updated.')),
      );
      _prefetchService.run(forceRefresh: true);
    }
  }

  Future<String> _verifyProductionAgentCanSeeJob(String jobId) async {
    final baseUrl = await getAgentBaseUrl();
    final appProjectId = Firebase.app().options.projectId;
    final uri = Uri.parse('$baseUrl/api/firestore/jobs/$jobId/status');

    Map<String, dynamic> data = <String, dynamic>{};
    int statusCode = 0;
    for (var attempt = 0; attempt < 10; attempt += 1) {
      final response = await http.get(uri).timeout(const Duration(seconds: 12));
      statusCode = response.statusCode;
      data = response.body.isNotEmpty
          ? jsonDecode(response.body) as Map<String, dynamic>
          : <String, dynamic>{};
      if (statusCode == 200 &&
          data['success'] == true &&
          data['visibleToAgent'] == true &&
          data['hasPrepTimer'] == true &&
          data['hasFireTimer'] == true) {
        break;
      }
      await Future<void>.delayed(const Duration(seconds: 2));
    }

    final agentProjectId = data['firebaseProjectId']?.toString();
    if (statusCode == 404 || data['visibleToAgent'] != true) {
      throw Exception(
        'Production agent cannot see this job. App Firebase=$appProjectId, agent Firebase=${agentProjectId ?? 'unknown'}.',
      );
    }
    if (statusCode != 200 || data['success'] != true) {
      throw Exception(data['error'] ?? 'Production agent job check failed');
    }
    if (agentProjectId != null &&
        agentProjectId.isNotEmpty &&
        agentProjectId != appProjectId) {
      throw Exception(
        'Firebase project mismatch. App=$appProjectId, agent=$agentProjectId.',
      );
    }
    if (data['agentRunMain'] != true || data['sniperRunnerStarted'] != true) {
      throw Exception('Production sniper runner is not active.');
    }
    if (data['agentWillAccept'] != true) {
      throw Exception(
        'Production agent can see the job but will not accept it: ${data['status']}/${data['state']}.',
      );
    }
    if (data['hasPrepTimer'] != true || data['hasFireTimer'] != true) {
      throw Exception(
        'Production agent has not registered both PREP and FIRE timers yet.',
      );
    }
    final secondsUntilPrep = data['secondsUntilPrep'];
    final secondsUntilFire = data['secondsUntilFire'];
    if (secondsUntilPrep is num &&
        secondsUntilFire is num &&
        !(secondsUntilPrep > 0 && secondsUntilFire > secondsUntilPrep)) {
      throw Exception(
        'Safe proof timers are not future-scheduled: prep=${secondsUntilPrep}s, fire=${secondsUntilFire}s.',
      );
    }

    final fireTime = data['computedFireTimeUtc'] ?? data['scheduledFor'];
    final prepTime = data['computedPrepTimeUtc'];
    final warmState = data['warmState'] ?? 'not warmed yet';
    final timerDetails = data['timerDetails'];
    final prepTimer = timerDetails is Map ? timerDetails['prepTimer'] : null;
    final fireTimer = timerDetails is Map ? timerDetails['fireTimer'] : null;
    final prepTimerId = prepTimer is Map ? prepTimer['timerId'] : null;
    final fireTimerId = fireTimer is Map ? fireTimer['timerId'] : null;
    final shortId = jobId.length <= 6 ? jobId : jobId.substring(0, 6);
    return 'Production confirmed job $shortId: prep=$prepTime (timer=$prepTimerId), fire=$fireTime (timer=$fireTimerId), warm=$warmState.';
  }

  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<Duration> _loadProductionPrepLead() async {
    final baseUrl = await getAgentBaseUrl();
    final response = await http
        .get(Uri.parse('$baseUrl/api/runtime-status'))
        .timeout(const Duration(seconds: 12));
    if (response.statusCode != 200) {
      return const Duration(minutes: 4);
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final raw = data['sniperPrepLeadMs'];
    if (raw is int && raw >= 0) return Duration(milliseconds: raw);
    return const Duration(minutes: 4);
  }

  int? _slotOpenSlots(Map<String, dynamic> slot) {
    final raw = slot['openSlots'] ?? slot['open_slots'];
    if (raw is int) return raw;
    if (raw is num) return raw.toInt();
    return int.tryParse(raw?.toString() ?? '');
  }

  Future<SafeProofCandidate> _findSafeProofCandidate(
    BookingJob template,
    Map<String, String> creds,
  ) async {
    final baseUrl = await getAgentBaseUrl();
    final start = DateTime.now();
    final startKey =
        '${start.year.toString().padLeft(4, '0')}-${start.month.toString().padLeft(2, '0')}-${start.day.toString().padLeft(2, '0')}';
    final response = await http
        .post(
          Uri.parse('$baseUrl/api/fetch-tee-times-range'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'startDate': startKey,
            'days': 14,
            'username': creds['username'],
            'password': creds['password'],
            'reuseBrowser': true,
            'teeMode': template.teeMode,
            'teeTarget': template.teeTarget,
            'includeUnavailable': false,
            'partySize': template.partySize ?? template.players.length + 1,
          }),
        )
        .timeout(const Duration(minutes: 3));
    if (response.statusCode != 200) {
      throw StateError('safe-availability-fetch-failed');
    }
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final days = decoded['days'];
    if (decoded['success'] != true || days is! List) {
      throw StateError('safe-availability-fetch-failed');
    }

    final partySize = template.partySize ?? template.players.length + 1;
    final preferred = template.preferredTimes.toSet();
    SafeProofCandidate? fallback;
    final preferredTee = template.teeTarget == 10 ? 10 : 1;
    final teeKey = preferredTee == 10 ? 'tee10' : 'tee1';
    bool isBookableSlot(Map<String, dynamic> slot) {
      final state = slot['state']?.toString().toLowerCase();
      final bookable = slot['bookable'];
      final href = slot['href']?.toString();
      return state == 'bookable' &&
          bookable == true &&
          href != null &&
          href.isNotEmpty;
    }

    for (final rawDay in days.whereType<Map>()) {
      final day = rawDay.cast<String, dynamic>();
      final date = day['date']?.toString();
      if (date == null || date.isEmpty) continue;
      final teeData = day[teeKey];
      final slots = (teeData is Map && teeData['safeProofCandidates'] is List)
          ? teeData['safeProofCandidates'] as List
          : (day['safeProofCandidates'] is List)
              ? day['safeProofCandidates'] as List
              : (day['slots'] is List)
                  ? day['slots'] as List
                  : (teeData is Map && teeData['slots'] is List)
                      ? teeData['slots'] as List
                      : const [];
      for (final rawSlot in slots.whereType<Map>()) {
        final slot = rawSlot.cast<String, dynamic>();
        final time = slot['time']?.toString();
        if (time == null || time.isEmpty) continue;
        if (!isBookableSlot(slot)) continue;
        final openSlots = _slotOpenSlots(slot);
        if (partySize > 1 && (openSlots == null || openSlots < partySize)) {
          continue;
        }
        final candidate = SafeProofCandidate(
          date: date,
          time: time,
          tee: preferredTee,
        );
        if (date == template.targetDate && preferred.contains(time)) {
          return candidate;
        }
        fallback ??= candidate;
      }
    }
    if (fallback == null) {
      throw StateError('no-current-bookable-proof-candidate');
    }
    return fallback;
  }

  Future<void> _runSafeProductionProof(List<BookingJob> jobs) async {
    if (_proofRunning) return;
    _proofWatchSub?.cancel();
    final uid = _firebaseService.currentUserId;
    if (uid == null) {
      _showSnack('Not logged in');
      return;
    }
    final creds = _savedCreds ?? await _firebaseService.loadBRSCredentials(uid);
    if (creds == null ||
        (creds['username'] ?? '').trim().isEmpty ||
        (creds['password'] ?? '').isEmpty) {
      _showSnack('Save BRS credentials first to run production proof.');
      return;
    }

    setState(() {
      _proofRunning = true;
      _proofStatusMessage = 'Creating safe proof job...';
    });

    try {
      final nowUtc = DateTime.now().toUtc();
      final template = selectSafeProofTemplate(jobs);
      if (template == null) {
        throw StateError(
            'No real sniper job is available as a proof template.');
      }
      final prepLead = await _loadProductionPrepLead();
      final candidate = await _findSafeProofCandidate(template, creds);
      final proofData = buildSafeProofPayload(
        ownerUid: uid,
        template: template,
        nowUtc: nowUtc,
        prepLead: prepLead,
        candidate: candidate,
      );

      final proofJobId = await _firebaseService.createJobFromMap(proofData);
      final message = await _verifyProductionAgentCanSeeJob(proofJobId);
      if (!mounted) return;
      setState(() {
        _proofJobId = proofJobId;
        _proofStatusMessage = message;
      });
      _watchSafeProofUntilTerminal(proofJobId);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 8)),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _proofRunning = false;
        _proofStatusMessage = 'Proof failed to start: $e';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Safe production proof failed to start: $e'),
          backgroundColor: Colors.red.shade700,
          duration: const Duration(seconds: 10),
        ),
      );
    }
  }

  void _watchSafeProofUntilTerminal(String proofJobId) {
    _proofWatchSub?.cancel();
    _proofWatchSub = _firebaseService.watchJob(proofJobId).listen((data) {
      if (!mounted || data == null) return;
      final view = classifySafeProofStatus(data);
      if (!view.isTerminal) return;
      setState(() {
        _proofRunning = false;
        _proofStatusMessage = view.title;
      });
      _proofWatchSub?.cancel();
      _proofWatchSub = null;
    }, onError: (Object error) {
      if (!mounted) return;
      setState(() {
        _proofRunning = false;
        _proofStatusMessage = 'Proof watch failed: $error';
      });
    });
  }

  String _proofDisplayText(String jobId, Map<String, dynamic> data) {
    final status = (data['status'] ?? '').toString();
    final state = (data['state'] ?? '').toString();
    final result = (data['result'] ?? '').toString();
    final error = (data['error_message'] ?? '').toString();
    final boundary = data['prebook_boundary'];
    final view = classifySafeProofStatus(data);
    final shortId = jobId.length <= 6 ? jobId : jobId.substring(0, 6);
    final parts = <String>[
      view.title,
      'Job $shortId: ${status.toUpperCase()}${state.isNotEmpty ? ' / ${state.toUpperCase()}' : ''}${result.isNotEmpty ? ' / $result' : ''}',
      if (data['proof_template_job_id'] != null)
        'Template: ${data['proof_template_job_id']}',
      if (data['proof_party_size'] != null)
        'Party size: ${data['proof_party_size']}',
      if (data['proof_candidate_date'] != null &&
          data['proof_candidate_time'] != null)
        'Candidate: ${data['proof_candidate_date']} ${data['proof_candidate_time']} tee ${data['proof_candidate_tee']}',
      if (data['fire_timer_drift_ms'] != null)
        'Fire drift: ${data['fire_timer_drift_ms']}ms',
      if (boundary is Map) ...[
        'Players validated: ${boundary['playersFilledOk'] == true ? 'YES' : 'NO'}',
        'Final submit verified: ${boundary['confirmControlVisible'] == true && boundary['confirmControlEnabled'] == true ? 'YES' : 'NO'}',
        'Real booking submitted: NO',
      ],
      if (error.isNotEmpty) 'Error: $error',
    ];
    return parts.join('\n');
  }

  String _partySizeLabel(BookingJob job) {
    final size = job.partySize ?? (job.players.length + 1);
    final unit = size == 1 ? 'player' : 'players';
    return '$size $unit';
  }

  String _primaryTimeLabel(BookingJob job) {
    return job.preferredTimes.isNotEmpty
        ? job.preferredTimes.first
        : 'No target time';
  }

  String _sniperStateLabel(BookingJob job) => sniperLifecycleLabel(job);

  DateTime _getNextSaturday() {
    final now = DateTime.now();
    int daysUntilSaturday = (DateTime.saturday - now.weekday) % 7;
    if (daysUntilSaturday == 0 && now.hour >= 12) daysUntilSaturday = 7;
    return now.add(Duration(days: daysUntilSaturday));
  }

  @override
  Widget build(BuildContext context) {
    final userId = _firebaseService.currentUserId;

    if (userId == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Container(
      decoration: const BoxDecoration(
        image: DecorationImage(
          image: AssetImage(
              'assets/images/ultra-hd-golf-course-green-grass-o7ygl39odg1jxipx.jpg'),
          fit: BoxFit.cover,
        ),
      ),
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          backgroundColor: Colors.white.withValues(alpha: 0.85),
          elevation: 2,
          title: Text('Fairway Sniper',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: LightModeColors.lightPrimary,
              )),
          actions: [
            StreamBuilder<bool>(
              stream: _firebaseService.isAdminStream(userId),
              builder: (context, snapshot) {
                if (snapshot.data == true) {
                  return IconButton(
                    icon: const Icon(Icons.admin_panel_settings),
                    tooltip: 'Admin Dashboard',
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                            builder: (_) => const AdminDashboard()),
                      );
                    },
                  );
                }
                return const SizedBox.shrink();
              },
            ),
            // Light/Dark Mode Toggle
            IconButton(
              icon: Icon(
                _isDarkMode ? Icons.light_mode : Icons.dark_mode,
                color: _isDarkMode ? Colors.amber : Colors.grey.shade700,
              ),
              tooltip: _isDarkMode ? 'Light Mode' : 'Dark Mode',
              onPressed: () {
                setState(() {
                  _isDarkMode = !_isDarkMode;
                });
              },
            ),
            PopupMenuButton<String>(
              offset: const Offset(0, 50),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
              icon: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                  ),
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFFFD700).withValues(alpha: 0.3),
                      blurRadius: 8,
                      spreadRadius: 1,
                    ),
                  ],
                ),
                child: const Center(
                  child: Icon(Icons.person, color: Colors.white, size: 20),
                ),
              ),
              itemBuilder: (context) => [
                PopupMenuItem<String>(
                  enabled: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _firebaseService.currentUser?.email ?? 'User',
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Fairway Sniper Member',
                        style: TextStyle(
                            fontSize: 12, color: Colors.grey.shade600),
                      ),
                      const Divider(height: 16),
                    ],
                  ),
                ),
                const PopupMenuItem<String>(
                  value: 'profile',
                  child: Row(
                    children: [
                      Icon(Icons.account_circle, size: 20),
                      SizedBox(width: 12),
                      Text('My Profile'),
                    ],
                  ),
                ),
                const PopupMenuItem<String>(
                  value: 'settings',
                  child: Row(
                    children: [
                      Icon(Icons.settings, size: 20),
                      SizedBox(width: 12),
                      Text('Settings'),
                    ],
                  ),
                ),
                const PopupMenuItem<String>(
                  value: 'help',
                  child: Row(
                    children: [
                      Icon(Icons.help_outline, size: 20),
                      SizedBox(width: 12),
                      Text('Help & Support'),
                    ],
                  ),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem<String>(
                  value: 'logout',
                  child: Row(
                    children: [
                      Icon(Icons.logout, size: 20, color: Colors.red),
                      SizedBox(width: 12),
                      Text('Sign Out', style: TextStyle(color: Colors.red)),
                    ],
                  ),
                ),
              ],
              onSelected: (value) async {
                switch (value) {
                  case 'logout':
                    // Show loading indicator
                    showDialog(
                      context: context,
                      barrierDismissible: false,
                      builder: (context) => const Center(
                        child: CircularProgressIndicator(),
                      ),
                    );

                    await _firebaseService.signOut();

                    // Close loading dialog
                    if (mounted) Navigator.of(context).pop();

                    // Navigation is handled by authStateChanges stream in main.dart
                    // No manual navigation needed
                    break;
                  case 'profile':
                    _showProfileDialog();
                    break;
                  case 'settings':
                    _showSettingsDialog();
                    break;
                  case 'help':
                    _showHelpDialog();
                    break;
                }
              },
            ),
          ],
        ),
        body: StreamBuilder<List<BookingJob>>(
          stream: _firebaseService.getUserJobs(userId),
          builder: (context, jobSnapshot) {
            // Debug: Log job statuses from Firestore
            if (jobSnapshot.hasData) {
              for (var job in jobSnapshot.data!) {
                print('🔍 [DASHBOARD] Job ${job.id}: status="${job.status}"');
              }
            }

            if (jobSnapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }

            if (jobSnapshot.hasError) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.error_outline,
                          size: 64, color: Colors.red),
                      const SizedBox(height: 16),
                      const Text(
                        'Unable to load data',
                        style: TextStyle(
                            fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      Text(
                        'Please check your Firestore security rules',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.grey.shade600),
                      ),
                      const SizedBox(height: AppSpacing.xl),
                      ElevatedButton.icon(
                        onPressed: () => setState(() {}),
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              );
            }

            final jobs = jobSnapshot.data ?? [];

            return RefreshIndicator(
              onRefresh: () async {
                await _loadWeather();
                await _loadNews();
                await _loadProfile();
              },
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 800),
                        padding: const EdgeInsets.all(AppSpacing.xl),
                        child: DashboardWelcomeCard(
                          displayName: _displayName,
                          savedCreds: _savedCreds,
                          loadingCreds: _loadingCreds,
                          onEditCreds: _editSavedCreds,
                          currentUserEmail: _firebaseService.currentUser?.email,
                        ),
                      ),
                    ),
                    Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 800),
                        padding: const EdgeInsets.all(AppSpacing.xl),
                        child: AnimatedBuilder(
                          animation: _prefetchService,
                          builder: (context, _) => DashboardPrefetchCard(
                            state: _prefetchService.state,
                            isRunning: _prefetchService.isRunning,
                            onRefresh: () =>
                                _prefetchService.run(forceRefresh: true),
                          ),
                        ),
                      ),
                    ),
                    Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 800),
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.xl),
                        child: _buildProofCard(jobs),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 800),
                        padding: const EdgeInsets.all(AppSpacing.xl),
                        child: _buildJobsList(jobs),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 800),
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.xl),
                        child: LocalTimeCard(isDarkMode: _isDarkMode),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 800),
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.xl),
                        child: _buildWeatherCard(jobs),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 800),
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.xl),
                        child: Row(
                          children: [
                            Expanded(child: _buildJokeButton()),
                            const SizedBox(width: AppSpacing.md),
                            Expanded(child: _buildCourseInfoButton()),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    _buildGolfNewsSection(),
                    const SizedBox(height: 20),
                    Center(
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 800),
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: _buildRecentRuns(userId),
                      ),
                    ),
                    const SizedBox(height: 20),
                  ],
                ),
              ),
            );
          },
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const ModeSelectionScreen()),
          ),
          backgroundColor:
              _prefetchService.state.isReady ? const Color(0xFF2E7D32) : null,
          icon: const Icon(Icons.add),
          label: Text(
            _prefetchService.state.isReady
                ? 'Ready to Book'
                : 'New Booking Job',
          ),
        ),
      ),
    );
  }

  Widget _buildWeatherCard(List<BookingJob> jobs) {
    if (_currentWeather == null) {
      return const SizedBox.shrink();
    }

    final current = _currentWeather!['current'];
    final currentWeatherCode = current['weathercode'] as int;
    final currentTemp = current['temperature_2m'];
    final currentWind = current['windspeed_10m'];
    final currentHumidity = current['relativehumidity_2m'];

    BookingJob? activeJob;
    if (jobs.isNotEmpty) {
      try {
        activeJob = jobs.firstWhere((j) => j.status == 'active');
      } catch (e) {
        activeJob = jobs.first;
      }
    }

    Map<String, dynamic>? bookingWeather;
    if (activeJob != null &&
        activeJob.preferredTimes.isNotEmpty &&
        _weatherForecast != null) {
      bookingWeather = _weatherService.getHourlyWeatherForTime(
        _weatherForecast!,
        _primaryTimeLabel(activeJob),
      );
    }

    final cardBg = _isDarkMode
        ? Colors.grey.shade900.withValues(alpha: 0.85)
        : Colors.white.withValues(alpha: 0.85);
    final textColor = _isDarkMode ? Colors.white : Colors.black87;
    final subtextColor =
        _isDarkMode ? Colors.grey.shade400 : Colors.grey.shade600;

    return Card(
      color: cardBg,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  _weatherService.getWeatherEmoji(currentWeatherCode),
                  style: const TextStyle(fontSize: 48),
                ),
                const SizedBox(width: 20),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Current Weather',
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color: textColor,
                                ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Galgorm Castle Golf Club',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: subtextColor,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _weatherService
                            .getWeatherDescription(currentWeatherCode),
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                              color: textColor,
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${currentTemp.round()}°C',
                        style:
                            Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  color: textColor,
                                  fontWeight: FontWeight.bold,
                                ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '💨 Wind: ${currentWind.round()} km/h  💧 Humidity: ${currentHumidity.round()}%',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: subtextColor,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (bookingWeather != null) ...[
              const SizedBox(height: 16),
              Divider(color: subtextColor.withValues(alpha: 0.3)),
              const SizedBox(height: 12),
              Row(
                children: [
                  Icon(Icons.golf_course,
                      color: Theme.of(context).colorScheme.primary, size: 20),
                  const SizedBox(width: 8),
                  Text(
                    'Tee Time Weather (${_primaryTimeLabel(activeJob!)})',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: textColor,
                        ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Text(
                    _weatherService
                        .getWeatherEmoji(bookingWeather['weathercode'] as int),
                    style: const TextStyle(fontSize: 28),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _weatherService.getWeatherDescription(
                              bookingWeather['weathercode'] as int),
                          style:
                              Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    color: textColor,
                                  ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${bookingWeather['temperature'].round()}°C  •  Wind: ${bookingWeather['windspeed'].round()} km/h',
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: subtextColor,
                                  ),
                        ),
                        if (bookingWeather['precipitation_probability'] != null)
                          Text(
                            '☔ Rain chance: ${bookingWeather['precipitation_probability']}%',
                            style:
                                Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: subtextColor,
                                    ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildGolfNewsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
                child:
                    const Icon(Icons.newspaper, color: Colors.white, size: 20),
              ),
              const SizedBox(width: 12),
              Text(
                'Latest Golf News',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: LightModeColors.lightOnPrimary,
                    fontWeight: FontWeight.bold),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.red,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.circle, color: Colors.white, size: 8),
                    SizedBox(width: 4),
                    Text(
                      'LIVE',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (_newsArticles == null)
          Container(
            height: 200,
            margin: const EdgeInsets.symmetric(horizontal: 20),
            decoration: BoxDecoration(
              color: _isDarkMode
                  ? Colors.grey.shade900.withValues(alpha: 0.85)
                  : Colors.grey.shade100,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Center(child: CircularProgressIndicator()),
          )
        else if (_newsArticles!.isEmpty)
          Container(
            height: 200,
            margin: const EdgeInsets.symmetric(horizontal: 20),
            decoration: BoxDecoration(
              color: _isDarkMode
                  ? Colors.grey.shade900.withValues(alpha: 0.85)
                  : Colors.grey.shade100,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Center(
              child: Text(
                'No news available',
                style: TextStyle(
                  color:
                      _isDarkMode ? Colors.grey.shade400 : Colors.grey.shade600,
                ),
              ),
            ),
          )
        else
          Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                height: 280,
                child: ListView.builder(
                  controller: _newsScrollController,
                  scrollDirection: Axis.horizontal,
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.only(left: 20, right: 20),
                  itemCount: _newsArticles!.length,
                  itemBuilder: (context, index) =>
                      _buildNewsCard(_newsArticles![index]),
                ),
              ),
              // Floating scroll arrows
              Positioned(
                right: 10,
                child: Container(
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                    ),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFFFFD700).withValues(alpha: 0.5),
                        blurRadius: 12,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () {
                        _newsScrollController.animateTo(
                          _newsScrollController.offset + 320,
                          duration: const Duration(milliseconds: 300),
                          curve: Curves.easeInOut,
                        );
                      },
                      customBorder: const CircleBorder(),
                      child: const Padding(
                        padding: EdgeInsets.all(12),
                        child: Icon(
                          Icons.arrow_forward_ios,
                          color: Colors.white,
                          size: 24,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 10,
                child: Container(
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                    ),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFFFFD700).withValues(alpha: 0.5),
                        blurRadius: 12,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () {
                        _newsScrollController.animateTo(
                          _newsScrollController.offset - 320,
                          duration: const Duration(milliseconds: 300),
                          curve: Curves.easeInOut,
                        );
                      },
                      customBorder: const CircleBorder(),
                      child: const Padding(
                        padding: EdgeInsets.all(12),
                        child: Icon(
                          Icons.arrow_back_ios_new,
                          color: Colors.white,
                          size: 24,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
      ],
    );
  }

  Widget _buildNewsCard(Map<String, dynamic> article) {
    final publishedAt = DateTime.tryParse(article['publishedAt'] ?? '');
    final url = article['url'] ?? '';

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () async {
          if (url.isNotEmpty) {
            // Show loading indicator
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Row(
                    children: [
                      const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor:
                              AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text('Opening article...',
                            overflow: TextOverflow.ellipsis),
                      ),
                    ],
                  ),
                  duration: const Duration(seconds: 2),
                  backgroundColor: const Color(0xFF2E7D32),
                ),
              );
            }

            try {
              final uri = Uri.parse(url);
              if (await canLaunchUrl(uri)) {
                await launchUrl(uri, mode: LaunchMode.externalApplication);
              } else {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content:
                          const Text('⚠️ Could not open article in browser'),
                      backgroundColor: Colors.orange,
                      action: SnackBarAction(
                        label: 'Copy Link',
                        textColor: Colors.white,
                        onPressed: () {
                          // In production, copy URL to clipboard
                        },
                      ),
                    ),
                  );
                }
              }
            } catch (e) {
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('❌ Error: ${e.toString().split(':').first}'),
                    backgroundColor: Colors.red,
                    action: SnackBarAction(
                      label: 'OK',
                      textColor: Colors.white,
                      onPressed: () {},
                    ),
                  ),
                );
              }
            }
          }
        },
        borderRadius: BorderRadius.circular(16),
        splashColor: const Color(0xFFFFD700).withValues(alpha: 0.3),
        highlightColor: const Color(0xFFFFD700).withValues(alpha: 0.1),
        child: Container(
          width: 320,
          margin: const EdgeInsets.only(right: 16),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white,
                Color(0xFFFFFDE7),
              ],
            ),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
                color: const Color(0xFFFFD700).withValues(alpha: 0.3)),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFFFFD700).withValues(alpha: 0.2),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Stack(
            children: [
              // Decorative corner ribbon
              Positioned(
                top: 0,
                right: 0,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                    ),
                    borderRadius: const BorderRadius.only(
                      topRight: Radius.circular(16),
                      bottomLeft: Radius.circular(16),
                    ),
                  ),
                  child: const Icon(Icons.auto_awesome,
                      color: Colors.white, size: 16),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: const Color(0xFF2E7D32),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            article['source'] ?? 'Golf News',
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        const Spacer(),
                        if (publishedAt != null)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(color: Colors.grey.shade300),
                            ),
                            child: Row(
                              children: [
                                Icon(Icons.schedule,
                                    size: 12, color: Colors.grey.shade600),
                                const SizedBox(width: 4),
                                Text(
                                  DateFormat('MMM dd').format(publishedAt),
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: Colors.grey.shade600,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    // Decorative line
                    Container(
                      height: 3,
                      width: 40,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                        ),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            article['title'] ?? '',
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              height: 1.3,
                              color: Colors.black87,
                            ),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                          if (article['description'] != null &&
                              article['description'].isNotEmpty) ...[
                            const SizedBox(height: 12),
                            Expanded(
                              child: Text(
                                article['description'],
                                style: TextStyle(
                                  fontSize: 14,
                                  color: Colors.grey.shade700,
                                  height: 1.5,
                                ),
                                maxLines: 4,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(
                                colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                              ),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.read_more,
                                    color: Colors.white, size: 18),
                                SizedBox(width: 8),
                                Text(
                                  'Read Full Story',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildJobsList(List<BookingJob> jobs) {
    final displayJobs = jobs.where((job) => !job.proofRun).toList();
    final liveCount = displayJobs.where((job) {
      if (job.bookingMode == BookingMode.sniper) return isLiveSniperJob(job);
      return job.status == 'active';
    }).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Active Booking Jobs',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: _isDarkMode ? Colors.white : Colors.black87,
                  ),
            ),
            Text(
              '$liveCount',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (displayJobs.isEmpty)
          Card(
            color: _isDarkMode
                ? Colors.grey.shade900.withValues(alpha: 0.85)
                : Colors.white.withValues(alpha: 0.85),
            child: Padding(
              padding: const EdgeInsets.all(40),
              child: Center(
                child: Column(
                  children: [
                    Icon(Icons.inbox_outlined,
                        size: 64, color: Colors.grey.shade400),
                    const SizedBox(height: 16),
                    Text(
                      'No booking jobs yet',
                      style: TextStyle(
                        color: _isDarkMode
                            ? Colors.grey.shade400
                            : Colors.grey.shade600,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Tap + to create your first job',
                      style: TextStyle(
                        color: _isDarkMode
                            ? Colors.grey.shade500
                            : Colors.grey.shade500,
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          )
        else
          ...displayJobs.map((job) => _buildJobCard(job)),
      ],
    );
  }

  Widget _buildJobCard(BookingJob job) {
    final cardBg = _isDarkMode
        ? Colors.grey.shade900.withValues(alpha: 0.85)
        : Colors.white.withValues(alpha: 0.85);
    final textColor = _isDarkMode ? Colors.white : Colors.black87;
    final subtextColor =
        _isDarkMode ? Colors.grey.shade400 : Colors.grey.shade600;
    final now = DateTime.now().toUtc();
    final bookingFireTime =
        job.scheduledFor ?? job.nextFireTimeUtc ?? job.releaseWindowStart;
    final timeUntilBooking =
        bookingFireTime != null && bookingFireTime.isAfter(now)
            ? bookingFireTime.difference(now)
            : null;

    // Calculate time until the actual tee time (target day + time)
    DateTime? targetDateTime = _getTargetDateTime(job);
    final timeUntilTeeTime =
        targetDateTime != null && targetDateTime.isAfter(DateTime.now())
            ? targetDateTime.difference(DateTime.now())
            : null;

    // Determine mode colors
    final isSniper = job.bookingMode == BookingMode.sniper;
    final isLiveJob =
        isSniper ? isLiveSniperJob(job) : isLiveJob;
    final isScheduledSniper = isSniper && isProductionScheduledSniper(job);
    final headerColor = isSniper
        ? const Color(0xFFFF6B35) // Bright orange for sniper
        : const Color(0xFF4A90E2); // Blue for normal
    final headerTextColor = Colors.white;

    return Card(
      elevation: 4,
      color: cardBg,
      shadowColor: isLiveJob
          ? (isSniper ? Colors.orange : Colors.blue).withValues(alpha: 0.3)
          : Colors.black12,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: isLiveJob
            ? BorderSide(
                color: (isSniper ? Colors.orange : Colors.blue)
                    .withValues(alpha: 0.3),
                width: 1)
            : BorderSide.none,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Mode Header
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            decoration: BoxDecoration(
              color: headerColor,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(16),
                topRight: Radius.circular(16),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  isSniper ? Icons.gps_fixed : Icons.event,
                  color: headerTextColor,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Text(
                  isSniper ? '🎯 SNIPER MODE' : '📅 NORMAL BOOKING',
                  style: TextStyle(
                    color: headerTextColor,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    letterSpacing: 0.5,
                  ),
                ),
                const Spacer(),
                if (isSniper)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      _sniperStateLabel(job),
                      style: TextStyle(
                        color: headerTextColor,
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          // Job Details
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        gradient: isLiveJob
                            ? LinearGradient(
                                colors: isSniper
                                    ? [Color(0xFFFF6B35), Color(0xFFFF8A50)]
                                    : [Color(0xFF4A90E2), Color(0xFF357ABD)],
                              )
                            : null,
                        color: !isLiveJob
                            ? Colors.grey.shade300
                            : null,
                        borderRadius: BorderRadius.circular(14),
                        boxShadow: isLiveJob
                            ? [
                                BoxShadow(
                                  color: (isSniper
                                          ? Color(0xFFFF6B35)
                                          : Color(0xFF4A90E2))
                                      .withValues(alpha: 0.4),
                                  blurRadius: 8,
                                  offset: const Offset(0, 2),
                                ),
                              ]
                            : null,
                      ),
                      child: Icon(
                        Icons.golf_course,
                        color:
                            isLiveJob ? Colors.white : Colors.grey,
                        size: 30,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${job.targetDay} at ${_primaryTimeLabel(job)}',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 17,
                              color: isLiveJob
                                  ? textColor
                                  : (_isDarkMode
                                      ? Colors.grey.shade500
                                      : Colors.grey.shade700),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Icon(Icons.people, size: 14, color: subtextColor),
                              const SizedBox(width: 4),
                              Text(
                                _partySizeLabel(job),
                                style: TextStyle(
                                    color: subtextColor, fontSize: 13),
                              ),
                              const SizedBox(width: 12),
                              Icon(Icons.location_on,
                                  size: 14, color: subtextColor),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text(
                                  job.club,
                                  style: TextStyle(
                                      color: subtextColor, fontSize: 13),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Info/Details button
                        IconButton(
                          icon: Icon(
                            Icons.info_outline,
                            color: isSniper
                                ? Colors.red.shade400
                                : Colors.blue.shade400,
                            size: 28,
                          ),
                          tooltip: 'View Details',
                          onPressed: () => _showJobDetailsDialog(job),
                        ),
                        // New sniper jobs schedule automatically. Only legacy paused
                        // sniper jobs retain a manual recovery arm action.
                        if (isSniper &&
                            (job.state ?? '').toLowerCase() == 'paused')
                          IconButton(
                            icon: const Icon(Icons.play_circle,
                                color: Colors.green, size: 28),
                            tooltip: 'Arm Sniper',
                            onPressed: () async {
                              await _firebaseService.updateJob(
                                job.id!,
                                const <String, dynamic>{
                                  'status': 'active',
                                  'state': 'queued',
                                },
                              );
                              try {
                                final message =
                                    await _verifyProductionAgentCanSeeJob(job.id!);
                                if (!context.mounted) return;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(message),
                                    duration: const Duration(seconds: 6),
                                  ),
                                );
                              } catch (e) {
                                if (!context.mounted) return;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(
                                      'Sniper needs attention: production did not confirm it: $e',
                                    ),
                                    backgroundColor: Colors.red.shade700,
                                    duration: const Duration(seconds: 12),
                                  ),
                                );
                              }
                            },
                          )
                        else if (isSniper)
                          IconButton(
                            icon: Icon(
                              isScheduledSniper
                                  ? Icons.verified
                                  : Icons.schedule,
                              color: isScheduledSniper
                                  ? Colors.green
                                  : Colors.orange,
                              size: 28,
                            ),
                            tooltip: isScheduledSniper
                                ? 'Sniper scheduled in production'
                                : 'Sniper is arming in production',
                            onPressed: null,
                          )
                        else
                          IconButton(
                            icon: Icon(
                              isLiveJob
                                  ? Icons.pause_circle
                                  : Icons.play_circle,
                              color: isLiveJob
                                  ? Colors.orange
                                  : Colors.green,
                              size: 28,
                            ),
                            tooltip: isLiveJob ? 'Pause Job' : 'Activate Job',
                            onPressed: () async {
                              final patch = isLiveJob
                                  ? const <String, dynamic>{
                                      'status': 'paused',
                                      'state': 'paused',
                                    }
                                  : const <String, dynamic>{
                                      'status': 'active',
                                      'state': 'active',
                                    };
                              await _firebaseService.updateJob(job.id!, patch);
                            },
                          ),
                        // Delete button
                        IconButton(
                          icon: const Icon(
                            Icons.delete_forever,
                            color: Colors.red,
                            size: 28,
                          ),
                          tooltip: 'Delete Job',
                          onPressed: () async {
                            // Show confirmation dialog
                            final confirm = await showDialog<bool>(
                              context: context,
                              builder: (context) => AlertDialog(
                                title: const Text('Delete Booking Job?'),
                                content: const Text(
                                  'This will permanently remove this booking job and all its history. This action cannot be undone.',
                                ),
                                actions: [
                                  TextButton(
                                    onPressed: () =>
                                        Navigator.of(context).pop(false),
                                    child: const Text('Cancel'),
                                  ),
                                  ElevatedButton(
                                    onPressed: () =>
                                        Navigator.of(context).pop(true),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: Colors.red,
                                    ),
                                    child: const Text(
                                      'Delete',
                                      style: TextStyle(color: Colors.white),
                                    ),
                                  ),
                                ],
                              ),
                            );

                            if (confirm == true) {
                              await _firebaseService.deleteJob(job.id!);
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('🗑️ Booking job deleted'),
                                    backgroundColor: Colors.red,
                                  ),
                                );
                              }
                            }
                          },
                        ),
                      ],
                    ),
                  ],
                ),
                if (isLiveJob) ...[
                  const SizedBox(height: 16),
                  const Divider(height: 1),
                  const SizedBox(height: 16),
                  if (isSniper) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: (isScheduledSniper ? Colors.green : Colors.orange)
                            .withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: (isScheduledSniper ? Colors.green : Colors.orange)
                              .withValues(alpha: 0.35),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            isScheduledSniper
                                ? '🎯 SNIPER SCHEDULED'
                                : 'Arming sniper…',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: isScheduledSniper
                                  ? Colors.green.shade700
                                  : Colors.orange.shade800,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            isScheduledSniper
                                ? 'Production has registered the PREP and FIRE schedule.'
                                : 'Waiting for production to confirm the PREP and FIRE timers.',
                            style: TextStyle(fontSize: 12, color: subtextColor),
                          ),
                          if (job.prepScheduledFor != null) ...[
                            const SizedBox(height: 8),
                            Text(
                              'PREP: ${DateFormat('EEE d MMM, h:mm:ss a').format(job.prepScheduledFor!.toLocal())} (your time)',
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: textColor),
                            ),
                          ],
                          if (bookingFireTime != null) ...[
                            const SizedBox(height: 3),
                            Text(
                              'FIRE: ${DateFormat('EEE d MMM, h:mm:ss a').format(bookingFireTime.toLocal())} (your time)',
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: textColor),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                  ],
                  // Only show countdown for Sniper mode (Normal mode books immediately)
                  if (job.bookingMode == BookingMode.sniper) ...[
                    // Countdown to Booking Time
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color:
                                const Color(0xFF2E7D32).withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Icon(
                            Icons.rocket_launch,
                            size: 20,
                            color: Color(0xFF2E7D32),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Fires in',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: textColor,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'FIRE / release: ${job.releaseDay} at ${job.releaseTimeLocal} UK',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: subtextColor,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (timeUntilBooking != null)
                          StreamBuilder<int>(
                            stream: Stream.periodic(
                                const Duration(seconds: 1), (i) => i),
                            builder: (context, snapshot) {
                              final updatedTime = bookingFireTime!
                                  .difference(DateTime.now().toUtc());
                              return Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 6),
                                decoration: BoxDecoration(
                                  gradient: const LinearGradient(
                                    colors: [
                                      Color(0xFF2E7D32),
                                      Color(0xFF43A047)
                                    ],
                                  ),
                                  borderRadius: BorderRadius.circular(8),
                                  boxShadow: [
                                    BoxShadow(
                                      color: const Color(0xFF2E7D32)
                                          .withValues(alpha: 0.3),
                                      blurRadius: 4,
                                      offset: const Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: Text(
                                  _formatDuration(updatedTime),
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                              );
                            },
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                  ],
                  // Countdown to Tee Time (for both Normal and Sniper)
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              const Color(0xFFFFD700).withValues(alpha: 0.2),
                              const Color(0xFFFFA000).withValues(alpha: 0.2),
                            ],
                          ),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(
                          Icons.emoji_events,
                          size: 20,
                          color: Color(0xFFF57C00),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Countdown to Tee Time',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: textColor,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${job.targetDay} at ${_primaryTimeLabel(job)}',
                              style: TextStyle(
                                fontSize: 11,
                                color: subtextColor,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (timeUntilTeeTime != null)
                        StreamBuilder<int>(
                          stream: Stream.periodic(
                              const Duration(seconds: 1), (i) => i),
                          builder: (context, snapshot) {
                            final updated =
                                targetDateTime!.difference(DateTime.now());
                            return Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  colors: [
                                    Color(0xFFFFD700),
                                    Color(0xFFF57C00)
                                  ],
                                ),
                                borderRadius: BorderRadius.circular(8),
                                boxShadow: [
                                  BoxShadow(
                                    color: const Color(0xFFFFD700)
                                        .withValues(alpha: 0.4),
                                    blurRadius: 4,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                              ),
                              child: Text(
                                _formatDuration(updated),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                ),
                              ),
                            );
                          },
                        ),
                    ],
                  ),
                  // For Normal mode bookings, show BRS website link
                  if (job.bookingMode == BookingMode.normal) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            const Color(0xFF4A90E2).withValues(alpha: 0.1),
                            const Color(0xFF357ABD).withValues(alpha: 0.1),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: const Color(0xFF4A90E2).withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.open_in_new,
                              size: 18, color: Color(0xFF4A90E2)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Booking Confirmed',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color: textColor,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                GestureDetector(
                                  onTap: () => _launchBRSWebsite(),
                                  child: Text(
                                    'View on BRS Website',
                                    style: TextStyle(
                                      fontSize: 11,
                                      color: const Color(0xFF4A90E2),
                                      decoration: TextDecoration.underline,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
                if ((job.state ?? '').toLowerCase() == 'paused')
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _isDarkMode
                            ? Colors.grey.shade800.withValues(alpha: 0.5)
                            : Colors.grey.shade100,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.pause_circle,
                              size: 16, color: subtextColor),
                          const SizedBox(width: 8),
                          Text(
                            'Sniper paused — arm it to schedule',
                            style: TextStyle(
                              fontSize: 13,
                              color: subtextColor,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  DateTime? _getTargetDateTime(BookingJob job) {
    try {
      if (job.preferredTimes.isEmpty) return null;

      // Parse target day (e.g., "Saturday")
      final now = DateTime.now();
      final targetDayName = job.targetDay;
      final weekdayMap = {
        'Monday': DateTime.monday,
        'Tuesday': DateTime.tuesday,
        'Wednesday': DateTime.wednesday,
        'Thursday': DateTime.thursday,
        'Friday': DateTime.friday,
        'Saturday': DateTime.saturday,
        'Sunday': DateTime.sunday,
      };

      final targetWeekday = weekdayMap[targetDayName];
      if (targetWeekday == null) return null;

      // Find next occurrence of target day
      int daysUntilTarget = (targetWeekday - now.weekday) % 7;
      if (daysUntilTarget == 0 && now.hour >= 12) daysUntilTarget = 7;

      final targetDate = now.add(Duration(days: daysUntilTarget));

      // Parse time (e.g., "08:00")
      final timeParts = _primaryTimeLabel(job).split(':');
      final hour = int.parse(timeParts[0]);
      final minute = int.parse(timeParts[1]);

      return DateTime(
          targetDate.year, targetDate.month, targetDate.day, hour, minute);
    } catch (e) {
      return null;
    }
  }

  Widget _buildProofCard(List<BookingJob> jobs) {
    return Card(
      elevation: 3,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.verified_user, color: Color(0xFF2E7D32)),
                const SizedBox(width: 8),
                Text(
                  'Safe Production Proof',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              'Runs a dry-run proof through Firestore → Railway → PREP/FIRE timers → BRS flow, and stops before irreversible booking.',
            ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed:
                  _proofRunning ? null : () => _runSafeProductionProof(jobs),
              icon: _proofRunning
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.play_arrow),
              label: Text(_proofRunning
                  ? 'Proof running...'
                  : 'Run Safe Production Proof'),
            ),
            if (_proofStatusMessage != null) ...[
              const SizedBox(height: 8),
              Text(_proofStatusMessage!),
            ],
            if (_proofJobId != null) ...[
              const SizedBox(height: 8),
              StreamBuilder<Map<String, dynamic>?>(
                stream: _firebaseService.watchJob(_proofJobId!),
                builder: (context, snapshot) {
                  final data = snapshot.data ?? const <String, dynamic>{};
                  return Text(_proofDisplayText(_proofJobId!, data));
                },
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildRecentRuns(String userId) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Recent Attempts',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
                color: _isDarkMode ? Colors.white : Colors.black87,
              ),
        ),
        const SizedBox(height: 16),
        StreamBuilder<List<BookingRun>>(
          stream: _firebaseService.getAllUserRuns(userId),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              print('Error loading runs: ${snapshot.error}');
              return Card(
                color: _isDarkMode
                    ? Colors.grey.shade900.withValues(alpha: 0.85)
                    : Colors.white.withValues(alpha: 0.85),
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Center(
                    child: Text(
                      'No booking attempts yet',
                      style: TextStyle(
                        color: _isDarkMode
                            ? Colors.grey.shade400
                            : Colors.grey.shade600,
                      ),
                    ),
                  ),
                ),
              );
            }

            if (!snapshot.hasData || snapshot.data!.isEmpty) {
              return Card(
                color: _isDarkMode
                    ? Colors.grey.shade900.withValues(alpha: 0.85)
                    : Colors.white.withValues(alpha: 0.85),
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Center(
                    child: Text(
                      'No booking attempts yet',
                      style: TextStyle(
                        color: _isDarkMode
                            ? Colors.grey.shade400
                            : Colors.grey.shade600,
                      ),
                    ),
                  ),
                ),
              );
            }

            final runs = snapshot.data!.take(5).toList();
            return Column(
              children: runs.map((run) => _buildRunCard(run)).toList(),
            );
          },
        ),
      ],
    );
  }

  Widget _buildRunCard(BookingRun run) {
    final resultIcon = _getResultIcon(run.result);
    final resultColor = _getResultColor(run.result);
    final cardBg = _isDarkMode
        ? Colors.grey.shade900.withValues(alpha: 0.85)
        : Colors.white.withValues(alpha: 0.85);
    final subtextColor =
        _isDarkMode ? Colors.grey.shade400 : Colors.grey.shade600;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: cardBg,
      child: ListTile(
        leading: Icon(resultIcon, color: resultColor),
        title: Text(
          _getResultText(run.result),
          style: TextStyle(color: resultColor, fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          DateFormat('MMM dd, yyyy • HH:mm').format(run.startedUtc.toLocal()),
          style: TextStyle(color: subtextColor),
        ),
        trailing: run.chosenTime != null
            ? Text(
                run.chosenTime!,
                style: TextStyle(
                    color: _isDarkMode ? Colors.white : Colors.black87),
              )
            : null,
      ),
    );
  }

  IconData _getResultIcon(String result) {
    switch (result) {
      case 'success':
        return Icons.check_circle;
      case 'fallback':
        return Icons.check_circle_outline;
      case 'needs-human':
        return Icons.warning;
      case 'failed':
        return Icons.error_outline;
      default:
        return Icons.pending;
    }
  }

  Color _getResultColor(String result) {
    switch (result) {
      case 'success':
        return Colors.green;
      case 'fallback':
        return Colors.blue;
      case 'needs-human':
        return Colors.orange;
      case 'failed':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  String _getResultText(String result) {
    switch (result) {
      case 'success':
        return 'Booking Successful';
      case 'fallback':
        return 'Fallback Slot Booked';
      case 'needs-human':
        return 'Verification Needed';
      case 'failed':
        return 'Booking Failed';
      default:
        return 'Pending';
    }
  }

  String _formatDuration(Duration duration) {
    if (duration.isNegative) return 'Overdue';

    final days = duration.inDays;
    final hours = duration.inHours % 24;
    final minutes = duration.inMinutes % 60;
    final seconds = duration.inSeconds % 60;

    if (days > 0) {
      return '${days}d ${hours}h ${minutes}m';
    } else if (hours > 0) {
      return '${hours}h ${minutes}m ${seconds}s';
    } else if (minutes > 0) {
      return '${minutes}m ${seconds}s';
    } else {
      return '${seconds}s';
    }
  }

  Future<void> _launchBRSWebsite() async {
    final Uri url = Uri.parse('https://members.brsgolf.com/galgorm/');
    try {
      if (await canLaunchUrl(url)) {
        await launchUrl(url, mode: LaunchMode.externalApplication);
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not open BRS website')),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error opening website: $e')),
        );
      }
    }
  }

  void _showProfileDialog() {
    final user = _firebaseService.currentUser;
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.account_circle, color: Color(0xFF2E7D32)),
            SizedBox(width: 12),
            Text('My Profile'),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildProfileItem('Email', user?.email ?? 'Not available'),
              const SizedBox(height: 12),
              _buildProfileItem('User ID', user?.uid ?? 'Not available'),
              const SizedBox(height: 12),
              _buildProfileItem(
                  'Account Created',
                  user?.metadata.creationTime != null
                      ? DateFormat('MMM dd, yyyy')
                          .format(user!.metadata.creationTime!)
                      : 'Not available'),
              const SizedBox(height: 12),
              _buildProfileItem(
                  'Last Sign In',
                  user?.metadata.lastSignInTime != null
                      ? DateFormat('MMM dd, yyyy HH:mm')
                          .format(user!.metadata.lastSignInTime!)
                      : 'Not available'),
              const Divider(height: 24),
              StreamBuilder<bool>(
                stream: _firebaseService.isAdminStream(user?.uid ?? ''),
                builder: (context, snapshot) {
                  if (snapshot.data == true) {
                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                        ),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.admin_panel_settings,
                              color: Colors.white, size: 20),
                          SizedBox(width: 8),
                          Text(
                            'Admin Account',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    );
                  }
                  return const SizedBox.shrink();
                },
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _buildProfileItem(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: Colors.grey.shade600,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }

  void _showSettingsDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.settings, color: Color(0xFF2E7D32)),
            SizedBox(width: 12),
            Text('Settings'),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.notifications),
                title: const Text('Push Notifications'),
                subtitle: const Text('Get notified about booking results'),
                trailing: Switch(
                  value: true,
                  onChanged: (value) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                          content: Text('Notification settings updated')),
                    );
                  },
                ),
                contentPadding: EdgeInsets.zero,
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.language),
                title: const Text('Language'),
                subtitle: const Text('English (UK)'),
                trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                contentPadding: EdgeInsets.zero,
                onTap: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                        content: Text('Language settings coming soon')),
                  );
                },
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.lock),
                title: const Text('Change Password'),
                trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                contentPadding: EdgeInsets.zero,
                onTap: () {
                  Navigator.of(context).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Password reset email sent!')),
                  );
                },
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.privacy_tip),
                title: const Text('Privacy Policy'),
                trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                contentPadding: EdgeInsets.zero,
                onTap: () {
                  Navigator.of(context).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Opening privacy policy...')),
                  );
                },
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  void _showHelpDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.help_outline, color: Color(0xFF2E7D32)),
            SizedBox(width: 12),
            Text('Help & Support'),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Fairway Sniper',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 4),
              const Text('Version 1.0.0'),
              const SizedBox(height: 20),
              _buildHelpItem(
                Icons.question_answer,
                'FAQ',
                'Common questions and answers',
              ),
              const SizedBox(height: 12),
              _buildHelpItem(
                Icons.mail_outline,
                'Contact Support',
                'support@fairwaysniper.com',
              ),
              const SizedBox(height: 12),
              _buildHelpItem(
                Icons.book_outlined,
                'User Guide',
                'Learn how to use Fairway Sniper',
              ),
              const SizedBox(height: 12),
              _buildHelpItem(
                Icons.bug_report_outlined,
                'Report a Bug',
                'Help us improve the app',
              ),
              const Divider(height: 32),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.green.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '💡 Quick Tip',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Booking jobs run automatically at the specified release time. Make sure your BRS credentials are up to date!',
                      style:
                          TextStyle(fontSize: 13, color: Colors.grey.shade700),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _buildJokeButton() {
    return ElevatedButton(
      onPressed: () => _showDirtyJoke(),
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        elevation: 4,
        shadowColor: const Color(0xFF2E7D32).withValues(alpha: 0.5),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.sentiment_very_satisfied, size: 28),
          const SizedBox(height: 8),
          Text(
            'Dirty Joke',
            style: GoogleFonts.ubuntu(
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildCourseInfoButton() {
    return ElevatedButton(
      onPressed: () {
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const CourseInfoScreen()),
        );
      },
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xFFFFD700),
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        elevation: 4,
        shadowColor: const Color(0xFFFFD700).withValues(alpha: 0.5),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.golf_course, size: 28),
          const SizedBox(height: 8),
          Text(
            'Course Info',
            style: GoogleFonts.ubuntu(
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  void _showDirtyJoke() {
    final jokes = [
      "Why do golfers bring two pairs of pants?\n\nIn case they get a hole in one! 😂",
      "What's the difference between a bad golfer and a bad skydiver?\n\nA bad golfer goes: WHACK! 'Damn!'\nA bad skydiver goes: 'Damn!' WHACK! 💀",
      "Golf balls are like eggs...\n\nThey're white, sold by the dozen, and a week later you have to buy more! 🥚⛳",
      "I'm not saying my golf game is bad...\n\nBut if I grew tomatoes, they'd come up sliced! 🍅",
      "Why did the golfer wear two pairs of socks?\n\nIn case he got a hole in one! (And yes, Big Mal brings backup pants too!) 🧦",
      "My golf game is like my love life...\n\nLots of balls ending up in the rough! 😏",
      "What do you call a blonde golfer with an IQ of 125?\n\nA foursome! 👯",
      "Golf is a lot like taxes...\n\nYou drive hard to get to the green, and then you end up in the hole! 💸⛳",
      "Why do they call it golf?\n\nBecause all the other four-letter words were taken! 🤬⛳",
      "My wife said she's leaving me because of my obsession with golf...\n\nI said, 'But honey, you're way off course!' 🏌️‍♂️💔",
    ];

    final random = (DateTime.now().millisecondsSinceEpoch % jokes.length);
    final joke = jokes[random];

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF2E7D32),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFFFFD700),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.sentiment_very_satisfied,
                  color: Colors.white, size: 28),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Big Mal\'s Dirty Joke',
                style: GoogleFonts.ubuntu(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 20,
                ),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Text(
            joke,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              height: 1.5,
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              // Show another joke
              _showDirtyJoke();
            },
            child: const Text(
              'Another One! 🤣',
              style: TextStyle(
                  color: Color(0xFFFFD700), fontWeight: FontWeight.bold),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFFD700),
              foregroundColor: const Color(0xFF2E7D32),
            ),
            child: const Text('Close',
                style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildHelpItem(IconData icon, String title, String subtitle) {
    return InkWell(
      onTap: () {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Opening $title...')),
        );
      },
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Row(
          children: [
            Icon(icon, size: 24, color: const Color(0xFF2E7D32)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    subtitle,
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios, size: 16),
          ],
        ),
      ),
    );
  }

  void _showJobDetailsDialog(BookingJob job) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Row(
          children: [
            Icon(
              job.bookingMode == BookingMode.sniper
                  ? Icons.my_location
                  : Icons.golf_course,
              color: job.bookingMode == BookingMode.sniper
                  ? Colors.red.shade400
                  : Colors.amber.shade700,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                job.bookingMode == BookingMode.sniper
                    ? 'Sniper Booking'
                    : 'Normal Booking',
                style: TextStyle(
                  color: job.bookingMode == BookingMode.sniper
                      ? Colors.red.shade400
                      : Colors.amber.shade700,
                ),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (job.id != null) ...[
                _buildDetailRow('Job ID', job.id!, Icons.tag),
                const Divider(),
              ],
              _buildDetailRow('Club', job.club, Icons.location_on),
              const Divider(),
              _buildDetailRow(
                'Target Day',
                job.targetDay,
                Icons.calendar_today,
              ),
              const Divider(),
              _buildDetailRow(
                'Preferred Times',
                job.preferredTimes.join(', '),
                Icons.access_time,
              ),
              const Divider(),
              _buildDetailRow(
                'Players',
                _partySizeLabel(job),
                Icons.people,
              ),
              const Divider(),
              _buildDetailRow(
                'Status',
                job.state == null
                    ? job.status.toUpperCase()
                    : '${job.status.toUpperCase()} / ${job.state!.toUpperCase()}',
                job.status == 'active' ? Icons.play_circle : Icons.pause_circle,
              ),
              if (job.bookingMode == BookingMode.sniper) ...[
                const Divider(),
                _buildDetailRow(
                  'Release Day',
                  job.releaseDay,
                  Icons.event_available,
                ),
                const Divider(),
                _buildDetailRow(
                  'Release Time',
                  job.releaseTimeLocal,
                  Icons.schedule,
                ),
              ],
              if (job.targetPlayDate != null) ...[
                const Divider(),
                _buildDetailRow(
                  'Target Date',
                  DateFormat('EEE, MMM d, yyyy').format(job.targetPlayDate!),
                  Icons.event,
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, IconData icon) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: Colors.grey.shade600),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey.shade600,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class LocalTimeCard extends StatefulWidget {
  final bool isDarkMode;

  const LocalTimeCard({super.key, required this.isDarkMode});

  @override
  State<LocalTimeCard> createState() => _LocalTimeCardState();
}

class _LocalTimeCardState extends State<LocalTimeCard> {
  late DateTime _currentTime;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _currentTime = DateTime.now();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (mounted) {
        setState(() {
          _currentTime = DateTime.now();
        });
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cardBg = widget.isDarkMode
        ? Colors.grey.shade900.withValues(alpha: 0.85)
        : Colors.white.withValues(alpha: 0.85);
    final textColor = widget.isDarkMode ? Colors.white : Colors.black87;
    final subtextColor =
        widget.isDarkMode ? Colors.grey.shade400 : Colors.grey.shade600;

    return Card(
      color: cardBg,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF2E7D32), Color(0xFF43A047)],
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child:
                  const Icon(Icons.access_time, color: Colors.white, size: 24),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Local Time',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: textColor,
                        ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    DateFormat('EEEE, MMMM d, yyyy').format(_currentTime),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: subtextColor,
                        ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFFFD700), Color(0xFFFFA000)],
                ),
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFFFD700).withValues(alpha: 0.3),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Text(
                DateFormat('HH:mm:ss').format(_currentTime),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
