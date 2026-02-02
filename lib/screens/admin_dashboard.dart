import 'package:flutter/material.dart';
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/theme/app_spacing.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';

class AdminDashboard extends StatefulWidget {
  const AdminDashboard({super.key});

  @override
  State<AdminDashboard> createState() => _AdminDashboardState();
}

class _AdminDashboardState extends State<AdminDashboard> {
  final _firebaseService = FirebaseService();
  int _selectedTab = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            Icon(Icons.admin_panel_settings, size: 20),
            SizedBox(width: 8),
            Text('Admin Dashboard', style: TextStyle(fontWeight: FontWeight.w600)),
          ],
        ),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
      ),
      body: Column(
        children: [
          Container(
            color: Colors.green.shade50,
            child: Row(
              children: [
                _buildTabButton('All Jobs', 0, Icons.work_outline),
                _buildTabButton('All Users', 1, Icons.people_outline),
                _buildTabButton('Feedback', 2, Icons.feedback_outlined),
                _buildTabButton('Agent Control', 3, Icons.smart_toy_outlined),
              ],
            ),
          ),
          Expanded(
            child: _buildTabContent(),
          ),
        ],
      ),
    );
  }

  Widget _buildTabButton(String label, int index, IconData icon) {
    final isSelected = _selectedTab == index;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _selectedTab = index),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 16),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: isSelected ? const Color(0xFF2E7D32) : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          child: Column(
            children: [
              Icon(icon, color: isSelected ? const Color(0xFF2E7D32) : Colors.grey),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  color: isSelected ? const Color(0xFF2E7D32) : Colors.grey,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTabContent() {
    switch (_selectedTab) {
      case 0:
        return _buildAllJobsView();
      case 1:
        return _buildAllUsersView();
      case 2:
        return _buildFeedbackView();
      case 3:
        return _buildAgentControlView();
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildAllJobsView() {
    return StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('jobs')
          .orderBy('created_at', descending: true)
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
          return _buildEmptyState('No jobs found', Icons.work_outline);
        }

        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: snapshot.data!.docs.length,
          itemBuilder: (context, index) {
            final doc = snapshot.data!.docs[index];
            final data = doc.data() as Map<String, dynamic>;
            return _buildJobCard(doc.id, data);
          },
        );
      },
    );
  }

  Widget _buildJobCard(String jobId, Map<String, dynamic> data) {
    final status = data['status'] ?? 'unknown';
    final ownerUid = data['ownerUid'] ?? 'unknown';
    final targetDay = data['targetDay'] ?? 'N/A';
    final club = data['club'] ?? 'N/A';
    final createdAt = (data['created_at'] as Timestamp?)?.toDate();

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        leading: Icon(
          Icons.golf_course,
          color: status == 'active' ? Colors.green : Colors.grey,
        ),
        title: Text('$targetDay @ $club', style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text('Owner: ${ownerUid.substring(0, 8)}... • $status'),
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Job ID: $jobId', style: const TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 8),
                Text('Status: $status'),
                if (createdAt != null)
                  Text('Created: ${DateFormat('MMM dd, yyyy HH:mm').format(createdAt)}'),
                const SizedBox(height: 12),
                Row(
                  children: [
                    ElevatedButton.icon(
                      onPressed: () => _toggleJobStatus(jobId, status),
                      icon: Icon(status == 'active' ? Icons.pause : Icons.play_arrow),
                      label: Text(status == 'active' ? 'Pause' : 'Activate'),
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton.icon(
                      onPressed: () => _deleteJob(jobId),
                      icon: const Icon(Icons.delete),
                      label: const Text('Delete'),
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAllUsersView() {
    return StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance.collection('users').snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
          return _buildEmptyState('No users found', Icons.people_outline);
        }

        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: snapshot.data!.docs.length,
          itemBuilder: (context, index) {
            final doc = snapshot.data!.docs[index];
            final data = doc.data() as Map<String, dynamic>;
            return _buildUserCard(doc.id, data);
          },
        );
      },
    );
  }

  Widget _buildUserCard(String userId, Map<String, dynamic> data) {
    final email = data['email'] ?? 'No email';
    final isAdmin = data['isAdmin'] == true;
    final createdAt = (data['created_at'] as Timestamp?)?.toDate();

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: isAdmin ? Colors.purple : Colors.green,
          child: Icon(
            isAdmin ? Icons.admin_panel_settings : Icons.person,
            color: Colors.white,
          ),
        ),
        title: Text(email, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('UID: ${userId.substring(0, 12)}...'),
            if (createdAt != null)
              Text('Joined: ${DateFormat('MMM dd, yyyy').format(createdAt)}'),
          ],
        ),
        trailing: isAdmin
            ? const Chip(
                label: Text('ADMIN', style: TextStyle(fontSize: 10)),
                backgroundColor: Colors.purple,
                labelStyle: TextStyle(color: Colors.white),
              )
            : TextButton(
                onPressed: () => _makeAdmin(userId),
                child: const Text('Make Admin'),
              ),
      ),
    );
  }

  Widget _buildFeedbackView() {
    return StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('feedback')
          .orderBy('created_at', descending: true)
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
          return _buildEmptyState('No feedback yet', Icons.feedback_outlined);
        }

        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: snapshot.data!.docs.length,
          itemBuilder: (context, index) {
            final doc = snapshot.data!.docs[index];
            final data = doc.data() as Map<String, dynamic>;
            return _buildFeedbackCard(doc.id, data);
          },
        );
      },
    );
  }

  Widget _buildFeedbackCard(String feedbackId, Map<String, dynamic> data) {
    final message = data['message'] ?? 'No message';
    final userId = data['userId'] ?? 'Anonymous';
    final createdAt = (data['created_at'] as Timestamp?)?.toDate();

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    message,
                    style: const TextStyle(fontSize: 16),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.delete, color: Colors.red),
                  onPressed: () => _deleteFeedback(feedbackId),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'From: ${userId.substring(0, 12)}...',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
            if (createdAt != null)
              Text(
                DateFormat('MMM dd, yyyy HH:mm').format(createdAt),
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildAgentControlView() {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  const Icon(Icons.smart_toy, size: 64, color: Colors.purple),
                  const SizedBox(height: 16),
                  const Text(
                    'Playwright Agent Control',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Control the Node.js Playwright automation agent from here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton.icon(
                    onPressed: _sendAgentCommand,
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Trigger Test Run'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.purple,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'Recent Agent Commands',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                    ),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: StreamBuilder<QuerySnapshot>(
                      stream: FirebaseFirestore.instance
                          .collection('agent_commands')
                          .orderBy('created_at', descending: true)
                          .limit(20)
                          .snapshots(),
                      builder: (context, snapshot) {
                        if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
                          return const Center(
                            child: Text('No commands sent yet', style: TextStyle(color: Colors.grey)),
                          );
                        }

                        return ListView.builder(
                          itemCount: snapshot.data!.docs.length,
                          itemBuilder: (context, index) {
                            final doc = snapshot.data!.docs[index];
                            final data = doc.data() as Map<String, dynamic>;
                            final command = data['command'] ?? 'unknown';
                            final status = data['status'] ?? 'pending';
                            final createdAt = (data['created_at'] as Timestamp?)?.toDate();

                            return ListTile(
                              leading: Icon(
                                status == 'completed' ? Icons.check_circle : Icons.pending,
                                color: status == 'completed' ? Colors.green : Colors.orange,
                              ),
                              title: Text(command),
                              subtitle: createdAt != null
                                  ? Text(DateFormat('HH:mm:ss').format(createdAt))
                                  : null,
                              trailing: Text(status),
                            );
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(String message, IconData icon) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 64, color: Colors.grey.shade400),
          const SizedBox(height: 16),
          Text(message, style: TextStyle(color: Colors.grey.shade600, fontSize: 16)),
        ],
      ),
    );
  }

  Future<void> _toggleJobStatus(String jobId, String currentStatus) async {
    final newStatus = currentStatus == 'active' ? 'paused' : 'active';
    await FirebaseFirestore.instance.collection('jobs').doc(jobId).update({
      'status': newStatus,
      'updated_at': Timestamp.now(),
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Job $newStatus')),
      );
    }
  }

  Future<void> _deleteJob(String jobId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Job?'),
        content: const Text('This will permanently delete this booking job.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await FirebaseFirestore.instance.collection('jobs').doc(jobId).delete();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Job deleted')),
        );
      }
    }
  }

  Future<void> _makeAdmin(String userId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Grant Admin Access?'),
        content: const Text('This will give the user full admin privileges.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await FirebaseFirestore.instance.collection('users').doc(userId).update({
        'isAdmin': true,
        'updated_at': Timestamp.now(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Admin access granted')),
        );
      }
    }
  }

  Future<void> _deleteFeedback(String feedbackId) async {
    await FirebaseFirestore.instance.collection('feedback').doc(feedbackId).delete();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Feedback deleted')),
      );
    }
  }

  Future<void> _sendAgentCommand() async {
    await FirebaseFirestore.instance.collection('agent_commands').add({
      'command': 'test_run',
      'status': 'pending',
      'created_at': Timestamp.now(),
      'created_by': _firebaseService.currentUserId,
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Test command sent to agent')),
      );
    }
  }
}
