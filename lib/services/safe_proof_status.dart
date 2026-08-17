class SafeProofStatusView {
  const SafeProofStatusView({
    required this.title,
    required this.isPass,
    required this.isFail,
    required this.isTerminal,
  });

  final String title;
  final bool isPass;
  final bool isFail;
  final bool isTerminal;
}

bool _truthyBoundary(Map<String, dynamic>? boundary) {
  return boundary != null && boundary['prebookBoundaryReached'] == true;
}

bool _hasProductionError(Map<String, dynamic> data) {
  final status = (data['status'] ?? '').toString().toLowerCase();
  final state = (data['state'] ?? '').toString().toLowerCase();
  final result = (data['result'] ?? '').toString();
  final error = (data['error_message'] ?? '').toString().trim();
  return status == 'error' ||
      status == 'failed' ||
      state == 'error' ||
      state == 'failed' ||
      result == 'PROOF_FAILED' ||
      error.isNotEmpty;
}

bool _isFinished(Map<String, dynamic> data) {
  final status = (data['status'] ?? '').toString().toLowerCase();
  final state = (data['state'] ?? '').toString().toLowerCase();
  return status == 'finished' ||
      status == 'completed' ||
      state == 'finished' ||
      state == 'completed';
}

SafeProofStatusView classifySafeProofStatus(Map<String, dynamic> data) {
  final boundary = data['prebook_boundary'];
  final boundaryMap =
      boundary is Map ? boundary.cast<String, dynamic>() : null;
  final result = (data['result'] ?? '').toString();
  final hasError = _hasProductionError(data);
  final finished = _isFinished(data);
  final boundaryReached = _truthyBoundary(boundaryMap);

  final pass =
      !hasError && finished && result == 'DRY_RUN_PREBOOK_REACHED' && boundaryReached;
  final fail = hasError ||
      (finished && (result.isNotEmpty || boundaryMap != null) && !pass);

  return SafeProofStatusView(
    title: pass
        ? 'SAFE PRODUCTION PROOF: PASS'
        : fail
            ? 'SAFE PRODUCTION PROOF: FAIL'
            : 'Safe production proof running',
    isPass: pass,
    isFail: fail,
    isTerminal: pass || fail,
  );
}
