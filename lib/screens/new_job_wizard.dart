import 'dart:convert';

import 'package:fairway_sniper/models/booking_job.dart';
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/services/player_directory_service.dart';
import 'package:fairway_sniper/services/agent_base_url.dart';
import 'package:fairway_sniper/services/availability_cache_service.dart';
import 'package:fairway_sniper/widgets/player_selector_modal.dart';
import 'package:fairway_sniper/widgets/player_list_editor.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';

class NewJobWizard extends StatefulWidget {
  const NewJobWizard({super.key});

  @override
  State<NewJobWizard> createState() => _NewJobWizardState();
}

class _NewJobWizardState extends State<NewJobWizard> {
  final _firebaseService = FirebaseService();
  late final PlayerDirectoryService _playerDirectoryService;
  final _pageController = PageController();
  int _currentPage = 0;

  final _brsEmailController = TextEditingController();
  final _brsPasswordController = TextEditingController();
  bool _obscureUsername = true;
  bool _obscurePassword = true;
  String _club = 'galgorm';
  String _releaseDay = 'Tuesday';
  String _releaseTime = '19:20';
  DateTime? _targetDate;
  String? _selectedTime; // For Normal mode: single time selection
  DateTime? _selectedDate; // For Normal mode: which day the selected time is on
  int _additionalPlayerCount = 1; // Additional players beyond Player 1
  List<String> _selectedPlayers = []; // Additional players (Player 2+)
  String? _currentUserName; // Player 1 (logged-in user)
  final List<TextEditingController> _playerControllers = [
    TextEditingController()
  ];
  static const int _rangeWindowDays = 5;
  String _agentBaseUrl = defaultAgentBaseUrl();
  bool _agentTesting = false;
  String? _agentTestStatus;
  bool _agentHealthOk = true;
  String? _agentHealthBaseUrl;
  bool _isFetchingAvailability = false;
  String? _availabilityError;
  DateTime? _availabilityFetchedAt;
  DateTime? _focusedAvailabilityDate;
  List<_DayAvailability> _availabilityDays = [];
  BookingMode _mode = BookingMode.normal; // booking strategy selection
  Map<String, String>? _savedCreds; // loaded from Firestore user profile
  bool _useSavedCreds = true; // default to using saved if present
  bool _loadingSavedCreds = false;
  bool _isRefreshingPlayers = false;
  bool _isNextBusy = false;
  final _availabilityCacheService = AvailabilityCacheService();
  int get _partySize => _additionalPlayerCount + 1;

  @override
  void initState() {
    super.initState();
    _playerDirectoryService = PlayerDirectoryService(
      firebaseService: _firebaseService,
    );
    _loadSavedCreds();
    _loadAgentBaseUrl();
    _runAgentDiagnostics();
  }

  @override
  void dispose() {
    _pageController.dispose();
    _brsEmailController.dispose();
    _brsPasswordController.dispose();
    for (var controller in _playerControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadSavedCreds() async {
    final uid = _firebaseService.currentUserId;
    if (uid == null) return;
    setState(() => _loadingSavedCreds = true);
    try {
      final creds = await _firebaseService.loadBRSCredentials(uid);
      if (!mounted) return;
      setState(() {
        _savedCreds = creds;
        _loadingSavedCreds = false;
      });
      if (creds != null) {
        // Prefill (user can toggle off to edit)
        _brsEmailController.text = creds['username'] ?? '';
        _brsPasswordController.text = creds['password'] ?? '';
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingSavedCreds = false);
    }
  }

  Future<void> _loadAgentBaseUrl() async {
    final url = await getAgentBaseUrl();
    if (!mounted) return;
    setState(() => _agentBaseUrl = url);
  }

  Future<void> _runAgentDiagnostics() async {
    final baseUrl = await getAgentBaseUrl();
    if (!mounted) return;
    setState(() => _agentHealthBaseUrl = baseUrl);

    final healthUrl = '$baseUrl/api/health';
    print('🚨🚨 [AGENT-DIAG] HEALTH CHECK URL: $healthUrl');
    try {
      final response = await http
          .get(Uri.parse(healthUrl))
          .timeout(const Duration(seconds: 8));
      print(
          '🚨🚨 [AGENT-DIAG] HEALTH STATUS: ${response.statusCode} BODY: ${response.body}');
      if (!mounted) return;
      setState(() => _agentHealthOk = response.statusCode == 200);
    } catch (e) {
      print('🚨🚨 [AGENT-DIAG] HEALTH ERROR: $e');
      if (!mounted) return;
      setState(() => _agentHealthOk = false);
    }

    if (!_agentHealthOk) return;

    final diagUser = _brsEmailController.text.trim();
    final diagPass = _brsPasswordController.text.trim();
    if (diagUser.isEmpty || diagPass.isEmpty) return;

    final fetchUrl = '$baseUrl/api/fetch-tee-times-range';
    final payload = {
      'startDate': DateTime.now().toIso8601String(),
      'days': _rangeWindowDays,
      'username': diagUser,
      'password': diagPass,
      'club': _club,
      'reuseBrowser': true,
    };
    print('🚨🚨 [AGENT-DIAG] FETCH URL: $fetchUrl');
    try {
      final response = await http.post(
        Uri.parse(fetchUrl),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );
      final body = response.body;
      final snippet = body.substring(0, body.length.clamp(0, 300));
      print(
          '🚨🚨 [AGENT-DIAG] FETCH STATUS: ${response.statusCode} BODY: $snippet');
    } catch (e) {
      print('🚨🚨 [AGENT-DIAG] FETCH ERROR: $e');
    }
  }

  Future<void> _nextPage() async {
    if (_isNextBusy) return;
    // Validate page 0 (BRS Credentials)
    if (_currentPage == 0) {
      final username = _brsEmailController.text.trim();
      final password = _brsPasswordController.text.trim();

      if (username.isEmpty || password.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('⚠️ Please enter both username and password'),
            backgroundColor: Colors.orange,
          ),
        );
        return;
      }
    }

    // Validate booking selection on page 1 (Live availability)
    if (_currentPage == 1) {
      if (_selectedTime == null || _selectedDate == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Select one tee time before continuing'),
            backgroundColor: Colors.orange,
          ),
        );
        return;
      }
    }

    // Validate players on page 2
    if (_currentPage == 2) {
      final requiredAdditional = _additionalPlayerCount;
      if (_selectedPlayers.length < requiredAdditional) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Add $requiredAdditional additional player(s)'),
            backgroundColor: Colors.orange,
          ),
        );
        return;
      }
    }

    // Page 1 validation removed - we skipped the Club & Schedule page for Normal mode

    if (_currentPage < 3) {
      // Changed from 4 to 3 (now 4 pages total)
      setState(() => _isNextBusy = true);
      _pageController
          .nextPage(
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeInOut,
          )
          .whenComplete(() {
        if (mounted) {
          setState(() => _isNextBusy = false);
        }
      });
    }
  }

  void _handlePageChanged(int page) {
    setState(() => _currentPage = page);
    if (page == 1) {
      // Changed from page 2 to page 1 (now the booking page is second)
      final hasCredentials = _brsEmailController.text.trim().isNotEmpty &&
          _brsPasswordController.text.trim().isNotEmpty;
      if (hasCredentials &&
          _availabilityDays.isEmpty &&
          !_isFetchingAvailability) {
        _refreshRangeFromAgent();
      }
    }
  }

  void _previousPage() {
    if (_currentPage > 0) {
      _pageController.previousPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  Future<void> _saveJob() async {
    print('🔵 _saveJob called');

    final userId = _firebaseService.currentUserId;
    print('🔵 User ID: $userId');

    if (userId == null) {
      print('❌ No user ID found');
      return;
    }

    // Use selected players from directory
    final players = _selectedPlayers;
    print('🔵 Players: $players');

    if (_selectedTime == null || _selectedDate == null) {
      print('❌ No tee time selected');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a tee time slot')),
      );
      return;
    }

    print('🔵 Getting FCM token...');
    final fcmToken = await _firebaseService.getFCMToken();
    print('🔵 FCM Token: ${fcmToken ?? "null"}');

    // Normal mode: single selected time, immediate booking
    final job = BookingJob(
      ownerUid: userId,
      brsEmail: _brsEmailController.text.trim(),
      brsPassword: _brsPasswordController.text,
      club: _club,
      timezone: 'Europe/London',
      releaseDay: _releaseDay,
      releaseTimeLocal: _releaseTime,
      targetDay: DateFormat('EEEE').format(_selectedDate!),
      preferredTimes: [_selectedTime!], // Single time for Normal mode
      players: players,
      partySize: _partySize,
      pushToken: fcmToken,
      bookingMode: _mode,
      targetPlayDate:
          _selectedDate, // Store exact date for Normal mode immediate booking
    );

    print('🔵 Job created: ${job.toJson()}');

    try {
      // Persist credentials if user opted to use or enter them
      await _firebaseService.saveBRSCredentials(
          userId, _brsEmailController.text.trim(), _brsPasswordController.text,
          club: _club);

      // For Normal mode: execute booking immediately
      if (_mode == BookingMode.normal) {
        print('🎯 NORMAL MODE - Executing immediate booking...');
        _showBookingProgressDialog();

        final bookingResult = await _executeImmediateBooking(
          username: _brsEmailController.text.trim(),
          password: _brsPasswordController.text,
          targetDate: _selectedDate!,
          preferredTimes: [_selectedTime!],
          players: players,
          partySize: _partySize,
          pushToken: fcmToken,
        );

        if (mounted) Navigator.of(context).pop(); // Close progress dialog

        if (bookingResult['success']) {
          print('✅ Booking executed successfully!');
          // Save job record to Firebase for history
          final jobId = await _firebaseService.createJob(
            job.copyWith(
              status: 'completed',
              nextFireTimeUtc: DateTime.now(), // Mark as already executed
            ),
          );
          print('✅ Job saved to Firebase with ID: $jobId');

          if (mounted) {
            Navigator.of(context).pop();
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  '✅ Tee time booked successfully!\nResult: ${bookingResult['result']}',
                ),
                backgroundColor: Colors.green,
              ),
            );
          }
        } else {
          print('❌ Booking failed: ${bookingResult['error']}');
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Booking failed: ${bookingResult['error']}'),
                backgroundColor: Colors.red,
              ),
            );
          }
        }
      } else {
        // For Sniper mode: save job to Firebase and schedule for release time
        print('🎯 SNIPER MODE - Saving job for scheduled execution...');
        final jobId = await _firebaseService.createJob(job);
        print('✅ Job saved successfully with ID: $jobId');

        if (mounted) {
          Navigator.of(context).pop();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Booking job created successfully! ID: $jobId'),
            ),
          );
        }
      }
    } catch (e, stackTrace) {
      print('❌ Error in _saveJob: $e');
      print('❌ Stack trace: $stackTrace');

      if (mounted) {
        if (Navigator.of(context).canPop()) {
          Navigator.of(context).pop(); // Close progress dialog if open
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  void _showBookingProgressDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: const [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Booking tee time...\nPlease wait'),
          ],
        ),
      ),
    );
  }

  Future<Map<String, dynamic>> _executeImmediateBooking({
    required String username,
    required String password,
    required DateTime targetDate,
    required List<String> preferredTimes,
    required List<String> players,
    required int partySize,
    required String? pushToken,
  }) async {
    String baseUrl = _agentBaseUrl;
    try {
      baseUrl = await getAgentBaseUrl();
      final client = http.Client();
      final response = await client
          .post(
            Uri.parse('$baseUrl/api/book-now'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'username': username,
              'password': password,
              'targetDate': targetDate.toIso8601String(),
              'preferredTimes': preferredTimes,
              'players': players,
              'partySize': partySize,
              'pushToken': pushToken,
            }),
          )
          .timeout(const Duration(seconds: 120));

      print('📲 Booking response status: ${response.statusCode}');
      print('📲 Booking response body: ${response.body}');

      if (response.statusCode == 200) {
        final result = jsonDecode(response.body) as Map<String, dynamic>;
        return {
          'success': result['success'] ?? false,
          'result': result['result'] ?? 'unknown',
          'error': result['error'],
        };
      } else {
        return {
          'success': false,
          'result': 'error',
          'error':
              'Agent error ${response.statusCode} at $baseUrl. ${_agentHelpText()}',
        };
      }
    } catch (e) {
      print('❌ Immediate booking error: $e');
      return {
        'success': false,
        'result': 'error',
        'error':
            'Failed to contact agent at $baseUrl. ${_agentHelpText()} ($e)',
      };
    }
  }

  @override
  Widget build(BuildContext context) {
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
          title: const Text('New Booking Job'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ),
        body: Center(
          child: Container(
            constraints: const BoxConstraints(maxWidth: 1000),
            decoration: BoxDecoration(
              color: Colors.black,
              borderRadius: BorderRadius.circular(16),
            ),
            margin: const EdgeInsets.symmetric(vertical: 20),
            child: Column(
              children: [
                if (!_agentHealthOk && _agentHealthBaseUrl != null)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 10),
                    color: Colors.red.shade700,
                    child: Text(
                      'AGENT NOT RUNNING at $_agentHealthBaseUrl',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                _buildProgressIndicator(),
                Expanded(
                  child: PageView(
                    controller: _pageController,
                    physics: const NeverScrollableScrollPhysics(),
                    onPageChanged: _handlePageChanged,
                    children: [
                      _buildPage0BrsCredentials(),
                      _buildPage2(), // Skip page 1 (Club & Schedule) for Normal mode - go straight to booking
                      _buildPage3(),
                      _buildPage4(),
                    ],
                  ),
                ),
                _buildNavigationButtons(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProgressIndicator() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Row(
        children: List.generate(4, (index) {
          // Changed from 5 to 4 steps
          final isActive = index == _currentPage;
          final isCompleted = index < _currentPage;

          return Expanded(
            child: Container(
              height: 4,
              margin: EdgeInsets.only(right: index < 4 ? 8 : 0),
              decoration: BoxDecoration(
                color: isCompleted || isActive
                    ? Theme.of(context).colorScheme.primary
                    : Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildPage0BrsCredentials() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.lock_outline, size: 64, color: Color(0xFF2E7D32)),
          const SizedBox(height: 24),
          Text(
            'BRS Golf Login',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Enter your BRS Golf account credentials for automated booking',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
          const SizedBox(height: 16),
          if (_loadingSavedCreds)
            const LinearProgressIndicator()
          else if (_savedCreds != null) ...[
            Card(
              color: Colors.green.shade50,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle, color: Colors.green),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Saved credentials found. Use them or toggle off to enter different ones.',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Colors.green.shade800),
                      ),
                    ),
                    Switch(
                      value: _useSavedCreds,
                      onChanged: (v) {
                        setState(() => _useSavedCreds = v);
                        if (v && _savedCreds != null) {
                          _brsEmailController.text =
                              _savedCreds!['username'] ?? '';
                          _brsPasswordController.text =
                              _savedCreds!['password'] ?? '';
                        } else if (!v) {
                          _brsEmailController.clear();
                          _brsPasswordController.clear();
                        }
                      },
                    ),
                  ],
                ),
              ),
            ),
          ] else ...[
            Card(
              color: Colors.yellow.shade50,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    const Icon(Icons.info_outline, color: Colors.orange),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'No saved credentials yet. They will be stored after you create your first job.',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Colors.orange.shade800),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 32),
          TextField(
            controller: _brsEmailController,
            obscureText: _obscureUsername,
            decoration: InputDecoration(
              labelText: 'BRS Username',
              prefixIcon: const Icon(Icons.person_outline),
              helperText: 'Your BRS Golf login username (usually numbers)',
              suffixIcon: IconButton(
                icon: Icon(
                  _obscureUsername ? Icons.visibility : Icons.visibility_off,
                ),
                onPressed: () =>
                    setState(() => _obscureUsername = !_obscureUsername),
              ),
            ),
            enabled: !_useSavedCreds || _savedCreds == null,
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _brsPasswordController,
            obscureText: _obscurePassword,
            decoration: InputDecoration(
              labelText: 'BRS Password',
              prefixIcon: const Icon(Icons.lock_outline),
              helperText: 'Your BRS Golf password',
              suffixIcon: IconButton(
                icon: Icon(
                  _obscurePassword ? Icons.visibility : Icons.visibility_off,
                ),
                onPressed: () =>
                    setState(() => _obscurePassword = !_obscurePassword),
              ),
            ),
            enabled: !_useSavedCreds || _savedCreds == null,
          ),
          const SizedBox(height: 24),
          _buildAgentConnectionRow(),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.blue.shade50,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.blue.shade200),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline, color: Colors.blue.shade700),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Your credentials are stored securely and only used by the automation agent to book tee times on your behalf.',
                    style: TextStyle(fontSize: 13, color: Colors.blue.shade900),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.orange.shade50,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.orange.shade200),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.warning_amber_rounded,
                    color: Colors.orange.shade700),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Important: If your BRS Golf credentials are incorrect, the booking process will fail. Please double-check your username and password.',
                    style: TextStyle(
                        fontSize: 13,
                        color: Colors.orange.shade900,
                        fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // _buildPage1 removed - Normal mode skips Club & Schedule configuration
  // and goes straight from credentials to booking page

  Widget _buildPage2() {
    final theme = Theme.of(context);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Book a Tee Time',
            style: theme.textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Choose additional players, then select ONE available slot to book immediately',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: Colors.grey.shade600,
            ),
          ),
          const SizedBox(height: 24),
          _buildSectionTitle('Additional Players'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const Icon(Icons.group),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Text('How many additional players?',
                        style: theme.textTheme.titleMedium),
                  ),
                  SegmentedButton<int>(
                    segments: const [
                      ButtonSegment(value: 0, label: Text('0')),
                      ButtonSegment(value: 1, label: Text('1')),
                      ButtonSegment(value: 2, label: Text('2')),
                      ButtonSegment(value: 3, label: Text('3')),
                    ],
                    selected: {_additionalPlayerCount},
                    onSelectionChanged: (Set<int> newSelection) {
                      final nextCount = newSelection.first;
                      setState(() {
                        _additionalPlayerCount = nextCount;
                        if (_selectedPlayers.length > _additionalPlayerCount) {
                          _selectedPlayers = _selectedPlayers
                              .take(_additionalPlayerCount)
                              .toList();
                        }
                      });
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          if (_selectedTime != null && _selectedDate != null) ...[
            Card(
              color: theme.colorScheme.primaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(Icons.check_circle, color: theme.colorScheme.primary),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Selected Slot',
                            style: theme.textTheme.labelMedium?.copyWith(
                              color: theme.colorScheme.onPrimaryContainer,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${DateFormat('EEEE d MMM').format(_selectedDate!)} at $_selectedTime',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: theme.colorScheme.onPrimaryContainer,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => setState(() {
                        _selectedTime = null;
                        _selectedDate = null;
                      }),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],
          _buildLiveAvailabilitySection(theme),
        ],
      ),
    );
  }

  Widget _buildLiveAvailabilitySection(ThemeData theme) {
    final hasCredentials = _brsEmailController.text.trim().isNotEmpty &&
        _brsPasswordController.text.trim().isNotEmpty;
    final bool canScan = hasCredentials && !_isFetchingAvailability;

    final List<Widget> body = [];

    if (_isFetchingAvailability) {
      body.add(const LinearProgressIndicator());
      body.add(const SizedBox(height: 12));
      body.add(Text(
        'Scanning tee sheets for the next $_rangeWindowDays days…',
        style: theme.textTheme.bodyMedium,
      ));
    } else if (!hasCredentials) {
      body.add(Text(
        'Enter your BRS credentials on Step 1 to preview live availability.',
        style:
            theme.textTheme.bodyMedium?.copyWith(color: Colors.grey.shade700),
      ));
    } else if (_availabilityError != null) {
      body.add(Text(
        _availabilityError!,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: Colors.red.shade700,
          fontWeight: FontWeight.w600,
        ),
      ));
      if (_availabilityDays.isNotEmpty) {
        body.add(const SizedBox(height: 12));
        body.add(Text(
          'Showing the last successful scan below.',
          style:
              theme.textTheme.bodySmall?.copyWith(color: Colors.grey.shade600),
        ));
        body.add(const SizedBox(height: 12));
        for (var i = 0; i < _availabilityDays.length; i++) {
          body.add(_buildAvailabilityDayCard(_availabilityDays[i], theme));
          if (i < _availabilityDays.length - 1) {
            body.add(const SizedBox(height: 12));
          }
        }
      }
    } else if (_availabilityDays.isEmpty) {
      body.add(Text(
        'No live data yet. Tap scan to fetch the next $_rangeWindowDays days.',
        style:
            theme.textTheme.bodyMedium?.copyWith(color: Colors.grey.shade700),
      ));
    } else {
      if (_availabilityFetchedAt != null) {
        final formatted =
            DateFormat('EEE d MMM · HH:mm').format(_availabilityFetchedAt!);
        body.add(Text(
          'Last scanned: $formatted',
          style:
              theme.textTheme.bodySmall?.copyWith(color: Colors.grey.shade600),
        ));
        body.add(const SizedBox(height: 12));
      }
      if (_targetDate != null &&
          !_availabilityDays
              .any((day) => _isSameDate(day.date, _targetDate!))) {
        body.add(Text(
          'Your selected target date is outside the next $_rangeWindowDays days.',
          style: theme.textTheme.bodySmall
              ?.copyWith(color: Colors.orange.shade700),
        ));
        body.add(const SizedBox(height: 12));
      }
      for (var i = 0; i < _availabilityDays.length; i++) {
        body.add(_buildAvailabilityDayCard(_availabilityDays[i], theme));
        if (i < _availabilityDays.length - 1) {
          body.add(const SizedBox(height: 12));
        }
      }
    }

    if (body.isNotEmpty) {
      body.add(const SizedBox(height: 16));
    }
    body.add(
      Align(
        alignment: Alignment.centerLeft,
        child: ElevatedButton.icon(
          onPressed: canScan ? () => _refreshRangeFromAgent(forceRefresh: true) : null,
          icon: const Icon(Icons.rss_feed),
          label: Text(_availabilityDays.isEmpty
              ? 'Scan Next $_rangeWindowDays Days'
              : 'Refresh Availability'),
        ),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Live Availability (Next $_rangeWindowDays Days)',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh availability',
              onPressed: canScan ? () => _refreshRangeFromAgent(forceRefresh: true) : null,
            ),
          ],
        ),
        const SizedBox(height: 12),
        Card(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: body,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAvailabilityDayCard(_DayAvailability day, ThemeData theme) {
    final bool isTargetDay =
        _targetDate != null && _isSameDate(day.date, _targetDate!);
    final bool isFocusedDay = _focusedAvailabilityDate != null &&
        _isSameDate(day.date, _focusedAvailabilityDate!);
    final Color focusColor = theme.colorScheme.primary;
    final Color borderColor = isFocusedDay ? focusColor : Colors.grey.shade200;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: borderColor, width: isFocusedDay ? 1.5 : 1),
      ),
      elevation: isFocusedDay ? 2 : 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _formatAvailabilityDay(day.date),
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: isFocusedDay ? focusColor : null,
                    ),
                  ),
                ),
                if (isTargetDay)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: focusColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: focusColor),
                    ),
                    child: Text(
                      'Target day',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: focusColor,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            if (day.times.isEmpty)
              Text(
                'No bookable tee times detected.',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: Colors.grey.shade600),
              )
            else
              Builder(builder: (context) {
                // Only show slots that can fit the selected party size (when we have capacity data)
                final filteredTimes = day.times.where((time) {
                  final summary = day.slotSummaries[time];
                  final bool hasSlotData =
                      summary != null && summary.openSlots != null;
                  if (!hasSlotData)
                    return true; // keep if no data so user can try
                  return (summary.openSlots ?? 0) >= _partySize;
                }).toList();

                if (filteredTimes.isEmpty) {
                  return Text(
                    'No tee times have at least $_partySize slots available.',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: Colors.grey.shade600),
                  );
                }

                return Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: filteredTimes.map((time) {
                    final summary = day.slotSummaries[time];
                    // If no slot summary, assume it's bookable (agent returned simple time list)
                    final bool hasSlotData =
                        summary != null && summary.openSlots != null;
                    final bool hasEnoughSlots = hasSlotData
                        ? (summary.openSlots ?? 0) >= _partySize
                        : true; // Default to enabled if no slot data
                    final bool selected = _selectedTime == time &&
                        _selectedDate != null &&
                        _isSameDate(_selectedDate!, day.date);
                    final bool isWaitList = summary?.status == 'waiting-list';
                    final Color baseColor =
                        isWaitList ? Colors.orange.shade700 : focusColor;

                    // Disable slots that don't have enough capacity (only if we have slot data)
                    final bool enabled = hasEnoughSlots || isWaitList;

                    return FilterChip(
                      label: Text(
                        _formatSlotLabel(time, summary, _partySize),
                        style: TextStyle(
                          color: selected
                              ? Colors.white
                              : (enabled ? baseColor : Colors.grey.shade400),
                          fontWeight:
                              selected ? FontWeight.w600 : FontWeight.w500,
                        ),
                      ),
                      selected: selected,
                      showCheckmark: false,
                      onSelected: enabled
                          ? (shouldSelect) =>
                              _togglePreferredTime(time, shouldSelect, day.date)
                          : null,
                      backgroundColor:
                          baseColor.withValues(alpha: enabled ? 0.08 : 0.03),
                      selectedColor: baseColor,
                      disabledColor: Colors.grey.shade200,
                      shape: StadiumBorder(
                        side: BorderSide(
                            color: enabled
                                ? baseColor.withValues(
                                    alpha: selected ? 1 : 0.4)
                                : Colors.grey.shade300),
                      ),
                    );
                  }).toList(),
                );
              }),
          ],
        ),
      ),
    );
  }

  String _formatAvailabilityDay(DateTime date) {
    return DateFormat('EEEE d MMM').format(date);
  }

  String _formatSlotLabel(String time, _SlotSummary? summary, int neededSlots) {
    if (summary == null) return time; // Just show time if no detail
    final open = summary.openSlots;
    final total = summary.totalSlots;

    String label = time;
    if (open != null && total != null) {
      label = '$time · $open/$total open';
    } else if (open != null) {
      final unit = open == 1 ? 'slot' : 'slots';
      label = '$time · $open $unit';
    } else if (total != null) {
      label = '$time · $total capacity';
    } else if (summary.status == 'waiting-list') {
      label = '$time · wait list';
    }

    return label;
  }

  void _togglePreferredTime(String time, bool shouldSelect, DateTime dayDate) {
    // Normal mode: single selection only
    setState(() {
      if (shouldSelect) {
        _selectedTime = time;
        _selectedDate = dayDate;
      } else {
        if (_selectedTime == time &&
            _selectedDate != null &&
            _isSameDate(_selectedDate!, dayDate)) {
          _selectedTime = null;
          _selectedDate = null;
        }
      }
    });
  }

  Future<void> _refreshRangeFromAgent({bool forceRefresh = false}) async {
    final username = _brsEmailController.text.trim();
    final password = _brsPasswordController.text.trim();

    if (username.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content:
              Text('Enter your BRS credentials on Step 1 to scan availability'),
          backgroundColor: Colors.orange,
        ),
      );
      setState(() {
        _availabilityError =
            'BRS credentials are required to fetch live availability.';
      });
      return;
    }

    setState(() {
      _isFetchingAvailability = true;
      _availabilityError = null;
    });

    List<_DayAvailability> nextDays = _availabilityDays;
    DateTime? fetchedAt = _availabilityFetchedAt;
    DateTime? focusedDate = _focusedAvailabilityDate;
    String? error;

    String baseUrl = _agentBaseUrl;
    try {
      baseUrl = await getAgentBaseUrl();
      if (!forceRefresh) {
        final entry = await _availabilityCacheService.getOrFetch(
          baseUrl: baseUrl,
          username: username,
          password: password,
          days: _rangeWindowDays,
          club: _club,
          reuseBrowser: true,
        );
        if (entry != null) {
          final parsed = _parseAvailabilityDays(entry.days);
          nextDays = parsed;
          fetchedAt = entry.fetchedAt;
          focusedDate = _computeFocusedAvailabilityDate(parsed);
        }
      }

      if (nextDays.isEmpty || forceRefresh) {
        debugPrint('[AvailabilityRange] Base URL: $baseUrl');
        final entry = await _availabilityCacheService.fetchAndCache(
          baseUrl: baseUrl,
          username: username,
          password: password,
          days: _rangeWindowDays,
          club: _club,
          reuseBrowser: true,
        );
        if (entry == null) {
          error =
              'Failed to fetch availability from $baseUrl. ${_agentHelpText()}';
        } else {
          final parsed = _parseAvailabilityDays(entry.days);
          nextDays = parsed;
          fetchedAt = entry.fetchedAt;
          focusedDate = _computeFocusedAvailabilityDate(parsed);
        }
      }
    } catch (e, st) {
      debugPrint('[AvailabilityRange] Exception: $e');
      debugPrint('[AvailabilityRange] Stack: $st');
      error =
          'Failed to contact agent at $baseUrl. ${_agentHelpText()} ($e)';
    }

    if (!mounted) return;

    setState(() {
      _isFetchingAvailability = false;
      if (error != null) {
        _availabilityError = error;
      } else {
        _availabilityError = null;
        _availabilityDays = nextDays;
        _availabilityFetchedAt = fetchedAt;
        _focusedAvailabilityDate = focusedDate;
      }
    });
  }

  List<_DayAvailability> _parseAvailabilityDays(List<dynamic> rawDays) {
    final List<_DayAvailability> parsed = [];
    for (final raw in rawDays) {
      if (raw is! Map) continue;
      final map = raw.cast<String, dynamic>();
      final dateStr = map['date']?.toString() ?? '';
      DateTime? date;
      if (dateStr.isNotEmpty) {
        try {
          date = DateTime.parse(dateStr);
        } catch (_) {
          date = null;
        }
      }
      date ??= DateTime.now();

      final times = <String>[];
      final seen = <String>{};
      final rawTimes = map['times'];
      if (rawTimes is List) {
        for (final entry in rawTimes) {
          if (entry == null) continue;
          final normalized = entry.toString().padLeft(5, '0');
          if (seen.add(normalized)) {
            times.add(normalized);
          }
        }
      }

      times.sort();

      final slots = <String, _SlotSummary>{};
      final rawSlots = map['slots'];
      if (rawSlots is List) {
        for (final entry in rawSlots) {
          if (entry is! Map) continue;
          final slotMap = entry.cast<String, dynamic>();
          final timeStr = slotMap['time']?.toString();
          if (timeStr == null || timeStr.isEmpty) continue;
          final normalized = timeStr.padLeft(5, '0');
          slots[normalized] = _SlotSummary(
            time: normalized,
            status: slotMap['status']?.toString() ?? 'bookable',
            openSlots: _firstInt(slotMap, const [
              'openSlots',
              'open',
              'available',
              'slotsAvailable',
              'spaces',
            ]),
            totalSlots: _firstInt(slotMap, const [
              'totalSlots',
              'total',
              'capacity',
              'slots',
            ]),
          );
        }
      }

      parsed.add(
          _DayAvailability(date: date, times: times, slotSummaries: slots));
    }
    parsed.sort((a, b) => a.date.compareTo(b.date));
    return parsed;
  }

  DateTime? _computeFocusedAvailabilityDate(List<_DayAvailability> days) {
    if (days.isEmpty) return null;
    if (_targetDate != null) {
      for (final day in days) {
        if (_isSameDate(day.date, _targetDate!)) {
          return day.date;
        }
      }
    }
    return days.first.date;
  }

  bool _isSameDate(DateTime a, DateTime b) {
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }

  int? _asNullableInt(dynamic value) {
    if (value == null) return null;
    if (value is int) return value;
    if (value is double) return value.round();
    if (value is String) return int.tryParse(value);
    return null;
  }

  int? _firstInt(Map<String, dynamic> map, List<String> keys) {
    for (final key in keys) {
      if (map.containsKey(key)) {
        final val = _asNullableInt(map[key]);
        if (val != null) return val;
      }
    }
    return null;
  }

  Widget _buildPage3() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Select Players',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Choose up to $_additionalPlayerCount additional players (Player 1 is you)',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
          const SizedBox(height: 12),
          if (_currentUserName != null && _currentUserName!.isNotEmpty)
            Text(
              'Player 1: $_currentUserName',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
            ),
          const SizedBox(height: 32),
          PlayerListEditor(
            playerNames: _selectedPlayers,
            onPlayersChanged: (updated) {
              setState(() => _selectedPlayers = updated);
            },
            onAddPlayers: _showPlayerSelector,
            maxPlayers: _additionalPlayerCount,
          ),
          if (_isRefreshingPlayers) ...[
            const SizedBox(height: 8),
            Text(
              'Updating player directory...',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: Colors.grey.shade600),
            ),
          ],
        ],
      ),
    );
  }

  String _agentHelpText() {
    return 'If you are on Android emulator, use http://10.0.2.2:3000. '
        'If you are on a physical phone, use your PC LAN IP (e.g. http://192.168.x.x:3000).';
  }

  Future<void> _showAgentUrlDialog() async {
    final controller = TextEditingController(text: _agentBaseUrl);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Agent Base URL'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: 'http://localhost:3000',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (result != null) {
      await setAgentBaseUrl(result);
      await _loadAgentBaseUrl();
      setState(() => _agentTestStatus = null);
    }
  }

  Future<void> _testAgentConnection() async {
    setState(() {
      _agentTesting = true;
      _agentTestStatus = null;
    });

    try {
      final baseUrl = await getAgentBaseUrl();
      final response =
          await http.get(Uri.parse('$baseUrl/api/health')).timeout(
                const Duration(seconds: 8),
              );
      if (!mounted) return;
      if (response.statusCode == 200) {
        setState(() {
          _agentTestStatus = '✅ Agent reachable at $baseUrl';
        });
      } else {
        setState(() {
          _agentTestStatus =
              '❌ Agent responded ${response.statusCode} at $baseUrl. ${_agentHelpText()}';
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _agentTestStatus =
            '❌ Failed to reach agent at $_agentBaseUrl. ${_agentHelpText()}';
      });
    } finally {
      if (mounted) {
        setState(() => _agentTesting = false);
      }
    }
  }

  Widget _buildAgentConnectionRow() {
    return Card(
      color: Colors.blueGrey.shade50,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.link, color: Colors.blueGrey),
                const SizedBox(width: 8),
                const Text(
                  'Agent Connection',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                const Spacer(),
                TextButton(
                  onPressed: _showAgentUrlDialog,
                  child: const Text('Change'),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _agentTesting ? null : _testAgentConnection,
                  child: _agentTesting
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Test'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _agentBaseUrl,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (_agentTestStatus != null) ...[
              const SizedBox(height: 6),
              Text(
                _agentTestStatus!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: _agentTestStatus!.startsWith('✅')
                          ? Colors.green
                          : Colors.red,
                    ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _showPlayerSelector() async {
    final selected = await PlayerSelectorModal.show(
      context: context,
      directoryService: _playerDirectoryService,
      initialSelectedNames: _selectedPlayers,
      maxPlayers: _additionalPlayerCount,
      username: _brsEmailController.text,
      password: _brsPasswordController.text,
    );

    if (selected != null) {
      setState(() {
        _selectedPlayers = selected;
        _isRefreshingPlayers = true;
      });
      print('🎯 Selected players from modal: $selected');

      // Refresh player directory in the background to update Player 1 name.
      _playerDirectoryService
          .getDirectory(
            username: _brsEmailController.text,
            password: _brsPasswordController.text,
          )
          .then((directory) {
        if (!mounted) return;
        setState(() {
          _currentUserName = directory?.currentUserName;
          _isRefreshingPlayers = false;
        });
      }).catchError((_) {
        if (!mounted) return;
        setState(() => _isRefreshingPlayers = false);
      });
    }
  }

  Widget _buildPage4() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Review & Confirm',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Please review your booking details',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
          const SizedBox(height: 32),
          _buildReviewCard(
            'Club',
            _club == 'galgorm' ? 'Galgorm Castle' : _club,
            Icons.golf_course,
          ),
          _buildReviewCard(
            'Selected Slot',
            _selectedTime != null && _selectedDate != null
                ? '${DateFormat('EEEE d MMM').format(_selectedDate!)} at $_selectedTime'
                : 'Not selected',
            Icons.access_time,
          ),
          _buildReviewCard(
            'Players',
            _selectedPlayers.isNotEmpty
                ? 'You, ${_selectedPlayers.join(', ')}'
                : 'You only',
            Icons.group,
          ),
        ],
      ),
    );
  }

  Widget _buildReviewCard(String title, String value, IconData icon) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .colorScheme
                    .primary
                    .withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: Theme.of(context).colorScheme.primary),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Colors.grey.shade600,
                        ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    value,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }

  Widget _buildNavigationButtons() {
    final busy = _isNextBusy || _isFetchingAvailability || _isRefreshingPlayers;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, -5),
          ),
        ],
      ),
      child: Row(
        children: [
          if (_currentPage > 0)
            Expanded(
              child: OutlinedButton(
                onPressed: busy ? null : _previousPage,
                child: const Text('Back'),
              ),
            ),
          if (_currentPage > 0) const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: ElevatedButton(
              onPressed: busy ? null : (_currentPage == 3 ? _saveJob : _nextPage),
              child: busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(_currentPage == 3 ? 'Create Job' : 'Continue'),
            ),
          ),
        ],
      ),
    );
  }
}

class _DayAvailability {
  _DayAvailability({
    required this.date,
    required this.times,
    required this.slotSummaries,
  });

  final DateTime date;
  final List<String> times;
  final Map<String, _SlotSummary> slotSummaries;
}

class _SlotSummary {
  _SlotSummary({
    required this.time,
    required this.status,
    this.openSlots,
    this.totalSlots,
  });

  final String time;
  final String status;
  final int? openSlots;
  final int? totalSlots;
}
