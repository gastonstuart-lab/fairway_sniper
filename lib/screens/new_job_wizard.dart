import 'package:flutter/material.dart';
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/models/booking_job.dart';

class NewJobWizard extends StatefulWidget {
  const NewJobWizard({super.key});

  @override
  State<NewJobWizard> createState() => _NewJobWizardState();
}

class _NewJobWizardState extends State<NewJobWizard> {
  final _firebaseService = FirebaseService();
  final _pageController = PageController();
  int _currentPage = 0;

  final _brsEmailController = TextEditingController();
  final _brsPasswordController = TextEditingController();
  bool _obscureUsername = true;
  bool _obscurePassword = true;
  String _club = 'galgorm';
  String _releaseDay = 'Tuesday';
  String _releaseTime = '19:20';
  String _targetDay = 'Saturday';
  DateTime? _targetDate;
  final List<String> _preferredTimes = [];
  final List<TextEditingController> _playerControllers = [TextEditingController()];

  final List<String> _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  // Standard Galgorm Castle tee times (7-day advance booking window)
  final List<String> _availableTimes = [
    '08:00', '08:10', '08:20', '08:30', '08:40', '08:50',
    '09:00', '09:10', '09:20', '09:30', '09:40', '09:50',
    '10:00', '10:10', '10:20', '10:30', '10:40', '10:50',
    '11:00', '11:10', '11:20', '11:30', '11:40', '11:50',
    '12:00', '12:10', '12:20', '12:30', '12:40', '12:50',
    '13:00', '13:10', '13:20', '13:30', '13:40', '13:50',
    '14:00', '14:10', '14:20', '14:30', '14:40', '14:50',
    '15:00', '15:10', '15:20', '15:30', '15:40', '15:50',
    '16:00', '16:10', '16:20', '16:30',
  ];

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

  Future<void> _nextPage() async {
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
    
    // Validate page 1 (schedule)
    if (_currentPage == 1) {
      if (_targetDate == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('⚠️ Please select a target play date'),
            backgroundColor: Colors.orange,
          ),
        );
        return;
      }
    }
    
    if (_currentPage < 4) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
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

    final players = _playerControllers.map((c) => c.text.trim()).where((p) => p.isNotEmpty).toList();
    print('🔵 Players: $players');
    
    if (players.isEmpty) {
      print('❌ No players found');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please add at least one player')),
      );
      return;
    }

    if (_preferredTimes.isEmpty) {
      print('❌ No preferred times found');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select at least one preferred time')),
      );
      return;
    }

    print('🔵 Getting FCM token...');
    final fcmToken = await _firebaseService.getFCMToken();
    print('🔵 FCM Token: ${fcmToken ?? "null"}');

    final job = BookingJob(
      ownerUid: userId,
      brsEmail: _brsEmailController.text.trim(),
      brsPassword: _brsPasswordController.text,
      club: _club,
      timezone: 'Europe/London',
      releaseDay: _releaseDay,
      releaseTimeLocal: _releaseTime,
      targetDay: _targetDay,
      preferredTimes: _preferredTimes,
      players: players,
      pushToken: fcmToken,
    );

    print('🔵 Job created: ${job.toJson()}');
    print('🔵 Saving to Firebase...');

    try {
      final jobId = await _firebaseService.createJob(job);
      print('✅ Job saved successfully with ID: $jobId');

      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Booking job created successfully! ID: $jobId')),
        );
      }
    } catch (e, stackTrace) {
      print('❌ Error saving job: $e');
      print('❌ Stack trace: $stackTrace');
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error creating job: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        image: DecorationImage(
          image: AssetImage('assets/images/ultra-hd-golf-course-green-grass-o7ygl39odg1jxipx.jpg'),
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
                _buildProgressIndicator(),
                Expanded(
                  child: PageView(
                    controller: _pageController,
                    physics: const NeverScrollableScrollPhysics(),
                    onPageChanged: (page) => setState(() => _currentPage = page),
                    children: [
                      _buildPage0BrsCredentials(),
                      _buildPage1(),
                      _buildPage2(),
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
        children: List.generate(5, (index) {
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
                onPressed: () => setState(() => _obscureUsername = !_obscureUsername),
              ),
            ),
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
                onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
              ),
            ),
          ),
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
                Icon(Icons.warning_amber_rounded, color: Colors.orange.shade700),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Important: If your BRS Golf credentials are incorrect, the booking process will fail. Please double-check your username and password.',
                    style: TextStyle(fontSize: 13, color: Colors.orange.shade900, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPage1() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Club & Schedule',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Configure your booking schedule',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
          const SizedBox(height: 32),
          _buildSectionTitle('Golf Club'),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _club,
                  isExpanded: true,
                  items: [
                    DropdownMenuItem(value: 'galgorm', child: Text('Galgorm Castle')),
                  ],
                  onChanged: (value) => setState(() => _club = value!),
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          _buildSectionTitle('Release Day & Time'),
          Text(
            'When do tee times become available?',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: _releaseDay,
                        isExpanded: true,
                        items: _weekdays.map((day) => DropdownMenuItem(value: day, child: Text(day))).toList(),
                        onChanged: (value) => setState(() => _releaseDay = value!),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Card(
                  child: InkWell(
                    onTap: () async {
                      final TimeOfDay? picked = await showTimePicker(
                        context: context,
                        initialTime: TimeOfDay(
                          hour: int.parse(_releaseTime.split(':')[0]),
                          minute: int.parse(_releaseTime.split(':')[1]),
                        ),
                        builder: (context, child) {
                          return Theme(
                            data: Theme.of(context).copyWith(
                              timePickerTheme: TimePickerThemeData(
                                backgroundColor: Colors.white,
                                dialBackgroundColor: Colors.grey.shade100,
                              ),
                            ),
                            child: child!,
                          );
                        },
                      );
                      if (picked != null) {
                        setState(() {
                          _releaseTime = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
                        });
                      }
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            _releaseTime,
                            style: const TextStyle(fontSize: 16),
                          ),
                          const Icon(Icons.access_time, size: 20),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          _buildSectionTitle('Target Play Date'),
          Text(
            'Select the date you want to play',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
          const SizedBox(height: 12),
          Card(
            child: InkWell(
              onTap: () async {
                final DateTime? picked = await showDatePicker(
                  context: context,
                  initialDate: _targetDate ?? DateTime.now().add(const Duration(days: 7)),
                  firstDate: DateTime.now(),
                  lastDate: DateTime.now().add(const Duration(days: 365)),
                  builder: (context, child) {
                    return Theme(
                      data: Theme.of(context).copyWith(
                        colorScheme: ColorScheme.light(
                          primary: const Color(0xFF2E7D32),
                          onPrimary: Colors.white,
                          surface: Colors.white,
                          onSurface: Colors.black87,
                        ),
                      ),
                      child: child!,
                    );
                  },
                );
                if (picked != null) {
                  setState(() {
                    _targetDate = picked;
                    final weekdayMap = {
                      DateTime.monday: 'Monday',
                      DateTime.tuesday: 'Tuesday',
                      DateTime.wednesday: 'Wednesday',
                      DateTime.thursday: 'Thursday',
                      DateTime.friday: 'Friday',
                      DateTime.saturday: 'Saturday',
                      DateTime.sunday: 'Sunday',
                    };
                    _targetDay = weekdayMap[picked.weekday]!;
                  });
                }
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        _targetDate != null
                            ? '${_targetDay}, ${_targetDate!.day}/${_targetDate!.month}/${_targetDate!.year}'
                            : 'Tap to select date',
                        style: TextStyle(
                          fontSize: 16,
                          color: _targetDate != null ? Colors.black87 : Colors.grey.shade600,
                        ),
                      ),
                    ),
                    const Icon(Icons.calendar_today, size: 20),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPage2() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Preferred Tee Times',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Select up to 3 times in order of preference',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
          const SizedBox(height: 24),
          
          // Show selected times
          if (_preferredTimes.isNotEmpty) ...[
            _buildSectionTitle('Selected Times'),
            ...List.generate(_preferredTimes.length, (index) {
              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: Theme.of(context).colorScheme.primary,
                    child: Text('${index + 1}', style: const TextStyle(color: Colors.white)),
                  ),
                  title: Text(_preferredTimes[index], style: const TextStyle(fontWeight: FontWeight.w600)),
                  trailing: IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(() => _preferredTimes.removeAt(index)),
                  ),
                ),
              );
            }),
            const SizedBox(height: 24),
          ],
          
          // Show available times
          if (_preferredTimes.length < 3) ...[
            _buildSectionTitle('Available Times (Tap to Select)'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _availableTimes.where((t) => !_preferredTimes.contains(t)).map((time) {
                return ActionChip(
                  label: Text(time),
                  backgroundColor: Theme.of(context).colorScheme.primary.withValues(alpha: 0.1),
                  side: BorderSide(color: Theme.of(context).colorScheme.primary),
                  onPressed: () {
                    if (_preferredTimes.length < 3) {
                      setState(() => _preferredTimes.add(time));
                    }
                  },
                );
              }).toList(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPage3() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Players',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            'Add up to 4 players for your booking',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Colors.grey.shade600,
                ),
          ),
          const SizedBox(height: 32),
          ...List.generate(_playerControllers.length, (index) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _playerControllers[index],
                      decoration: InputDecoration(
                        labelText: 'Player ${index + 1}',
                        prefixIcon: const Icon(Icons.person),
                      ),
                    ),
                  ),
                  if (index > 0)
                    IconButton(
                      icon: const Icon(Icons.remove_circle_outline),
                      color: Colors.red,
                      onPressed: () {
                        setState(() {
                          _playerControllers[index].dispose();
                          _playerControllers.removeAt(index);
                        });
                      },
                    ),
                ],
              ),
            );
          }),
          if (_playerControllers.length < 4)
            OutlinedButton.icon(
              onPressed: () => setState(() => _playerControllers.add(TextEditingController())),
              icon: const Icon(Icons.add),
              label: const Text('Add Player'),
            ),
        ],
      ),
    );
  }

  Widget _buildPage4() {
    final players = _playerControllers.map((c) => c.text.trim()).where((p) => p.isNotEmpty).toList();
    
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
            'Release Schedule',
            '$_releaseDay at $_releaseTime',
            Icons.schedule,
          ),
          _buildReviewCard(
            'Target Day',
            _targetDay,
            Icons.calendar_today,
          ),
          _buildReviewCard(
            'Preferred Times',
            _preferredTimes.join(', '),
            Icons.access_time,
          ),
          _buildReviewCard(
            'Players (${players.length})',
            players.join(', '),
            Icons.people,
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
                color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.1),
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
                onPressed: _previousPage,
                child: const Text('Back'),
              ),
            ),
          if (_currentPage > 0) const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: ElevatedButton(
              onPressed: _currentPage == 4 ? _saveJob : _nextPage,
              child: Text(_currentPage == 4 ? 'Create Job' : 'Continue'),
            ),
          ),
        ],
      ),
    );
  }
}
