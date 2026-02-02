import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/theme/app_spacing.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _nameController = TextEditingController();
  final _firebaseService = FirebaseService();
  bool _isLoading = false;
  bool _isSignUp = false;
  bool _rememberMe = true; // Default on so users can stay signed in
  bool _autoSigningIn = false;

  @override
  void initState() {
    super.initState();
    _loadSavedCredentials();
  }

  Future<void> _loadSavedCredentials() async {
    final prefs = await SharedPreferences.getInstance();
    final savedEmail = prefs.getString('saved_email');
    final savedPassword = prefs.getString('saved_password');
    final rememberMe = prefs.getBool('remember_me') ?? false;

    if (savedEmail != null && savedPassword != null && rememberMe) {
      setState(() {
        _emailController.text = savedEmail;
        _passwordController.text = savedPassword;
        _rememberMe = true;
      });

      // Attempt automatic sign-in if not already authenticated
      if (FirebaseAuth.instance.currentUser == null && !_autoSigningIn) {
        _autoSigningIn = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _authenticate(autoTriggered: true);
        });
      }
    }
  }

  Future<void> _saveCredentials() async {
    final prefs = await SharedPreferences.getInstance();
    if (_rememberMe) {
      await prefs.setString('saved_email', _emailController.text.trim());
      await prefs.setString('saved_password', _passwordController.text);
      await prefs.setBool('remember_me', true);
    } else {
      await prefs.remove('saved_email');
      await prefs.remove('saved_password');
      await prefs.setBool('remember_me', false);
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _authenticate({bool autoTriggered = false}) async {
    print('🔵 Authentication started - isSignUp: $_isSignUp');
    if (_emailController.text.trim().isEmpty ||
        _passwordController.text.isEmpty) {
      print('❌ Empty fields detected');
      if (!autoTriggered) {
        _showError('Please fill in all fields');
      }
      return;
    }

    print('🔵 Email: ${_emailController.text.trim()}');
    setState(() => _isLoading = true);

    try {
      if (_isSignUp) {
        print('🔵 Calling signUpWithEmail...');
        await _firebaseService.signUpWithEmail(
          _emailController.text.trim(),
          _passwordController.text,
          displayName: _nameController.text.trim(),
        );
        print('✅ Sign up successful');
        await _saveCredentials();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ Account created successfully!'),
              backgroundColor: Colors.green,
            ),
          );
        }
      } else {
        print('🔵 Calling signInWithEmail...');
        await _firebaseService.signInWithEmail(
          _emailController.text.trim(),
          _passwordController.text,
        );
        print('✅ Sign in successful');
        await _saveCredentials();
        if (mounted && !autoTriggered) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('✅ Signed in successfully!'),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 1),
            ),
          );
        }
      }
      // Navigation is handled by authStateChanges stream in main.dart
    } on FirebaseAuthException catch (e) {
      print('❌ FirebaseAuthException: ${e.code} - ${e.message}');
      String errorMsg = 'Authentication failed';
      if (e.code == 'user-not-found') {
        errorMsg = 'No account found with this email';
      } else if (e.code == 'wrong-password') {
        errorMsg = 'Incorrect password';
      } else if (e.code == 'email-already-in-use') {
        errorMsg = 'Email already registered';
      } else if (e.code == 'invalid-email') {
        errorMsg = 'Invalid email address';
      } else if (e.code == 'weak-password') {
        errorMsg = 'Password is too weak';
      } else if (e.message != null) {
        errorMsg = e.message!;
      }
      if (!autoTriggered) {
        _showError(errorMsg);
      }
    } catch (e) {
      print('❌ General error: $e');
      if (!autoTriggered) {
        _showError('Connection error. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          image: DecorationImage(
            image: AssetImage(
                'assets/images/ultra-hd-golf-course-green-grass-o7ygl39odg1jxipx.jpg'),
            fit: BoxFit.cover,
          ),
        ),
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                const Color(0xFF1B5E20).withValues(alpha: 0.7),
                const Color(0xFF2E7D32).withValues(alpha: 0.8),
              ],
            ),
          ),
          child: SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.xxl),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 450),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.xl),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.15),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.golf_course,
                              size: 80, color: Colors.white),
                        ),
                        const SizedBox(height: AppSpacing.xxl),
                        Text(
                          "Big Mal the Fairway Sniper",
                          style: GoogleFonts.ubuntu(
                            fontSize: 32,
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1.5,
                            shadows: [
                              Shadow(
                                color: Colors.black.withValues(alpha: 0.5),
                                offset: const Offset(2, 2),
                                blurRadius: 4,
                              ),
                            ],
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Auto-book your perfect tee time',
                          style:
                              Theme.of(context).textTheme.bodyLarge?.copyWith(
                                    color: Colors.white.withValues(alpha: 0.9),
                                  ),
                        ),
                        const SizedBox(height: AppSpacing.xxl),
                        Container(
                          padding:
                              EdgeInsets.only(left: AppSpacing.xxl, top: AppSpacing.xxl, right: AppSpacing.xxl),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(24),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.2),
                                blurRadius: 20,
                                offset: const Offset(0, 10),
                              ),
                            ],
                          ),
                          child: Column(
                            children: [
                              if (_isSignUp) ...[
                                TextField(
                                  controller: _nameController,
                                  textCapitalization: TextCapitalization.words,
                                  style: const TextStyle(color: Colors.black87),
                                  decoration: InputDecoration(
                                    labelText: 'Full Name',
                                    labelStyle:
                                        TextStyle(color: Colors.grey[700]),
                                    prefixIcon: Icon(Icons.person_outline,
                                        color: Colors.grey[600]),
                                  ),
                                ),
                                const SizedBox(height: AppSpacing.xl),
                              ],
                              TextField(
                                controller: _emailController,
                                keyboardType: TextInputType.emailAddress,
                                style: const TextStyle(color: Colors.black87),
                                decoration: InputDecoration(
                                  labelText: 'Email',
                                  labelStyle:
                                      TextStyle(color: Colors.grey[700]),
                                  prefixIcon: Icon(Icons.email_outlined,
                                      color: Colors.grey[600]),
                                ),
                              ),
                              const SizedBox(height: AppSpacing.xl),
                              TextField(
                                controller: _passwordController,
                                obscureText: true,
                                style: const TextStyle(color: Colors.black87),
                                decoration: InputDecoration(
                                  labelText: 'Password',
                                  labelStyle:
                                      TextStyle(color: Colors.grey[700]),
                                  prefixIcon: Icon(Icons.lock_outline,
                                      color: Colors.grey[600]),
                                ),
                              ),
                              const SizedBox(height: AppSpacing.md),
                              CheckboxListTile(
                                value: _rememberMe,
                                onChanged: (value) {
                                  setState(() => _rememberMe = value ?? false);
                                },
                                title: const Text(
                                  'Remember me on this device',
                                  style: TextStyle(color: Colors.black87),
                                ),
                                controlAffinity:
                                    ListTileControlAffinity.leading,
                                contentPadding: EdgeInsets.zero,
                              ),
                              const SizedBox(height: AppSpacing.xxl),
                              SizedBox(
                                width: double.infinity,
                                height: 56,
                                child: ElevatedButton(
                                  onPressed: _isLoading ? null : _authenticate,
                                  child: _isLoading
                                      ? const CircularProgressIndicator(
                                          color: Colors.white)
                                      : Text(
                                          _isSignUp
                                              ? 'Create Account'
                                              : 'Sign In',
                                          style: const TextStyle(
                                              fontSize: 16,
                                              fontWeight: FontWeight.w600),
                                        ),
                                ),
                              ),
                              const SizedBox(height: AppSpacing.lg),
                              TextButton(
                                onPressed: () =>
                                    setState(() => _isSignUp = !_isSignUp),
                                child: Text(
                                  _isSignUp
                                      ? 'Already have an account? Sign In'
                                      : 'Don\'t have an account? Sign Up',
                                  style: TextStyle(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .primary),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
