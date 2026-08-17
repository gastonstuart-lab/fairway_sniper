import 'package:flutter_test/flutter_test.dart';
import 'package:fairway_sniper/services/safe_proof_status.dart';

Map<String, dynamic> proofData({
  String status = 'active',
  String state = 'ready',
  String result = '',
  String error = '',
  bool boundaryReached = false,
}) {
  return {
    'status': status,
    'state': state,
    'result': result,
    if (error.isNotEmpty) 'error_message': error,
    'prebook_boundary': {
      'prebookBoundaryReached': boundaryReached,
    },
  };
}

void main() {
  test('boundary reached plus status error is FAIL', () {
    final view = classifySafeProofStatus(proofData(
      status: 'error',
      state: 'error',
      result: 'DRY_RUN_PREBOOK_REACHED',
      boundaryReached: true,
    ));

    expect(view.title, 'SAFE PRODUCTION PROOF: FAIL');
    expect(view.isPass, false);
    expect(view.isFail, true);
    expect(view.isTerminal, true);
  });

  test('dry-run result plus error message is FAIL', () {
    final view = classifySafeProofStatus(proofData(
      status: 'finished',
      state: 'finished',
      result: 'DRY_RUN_PREBOOK_REACHED',
      error: 'proof-boundary-proof-candidate-time-mismatch',
      boundaryReached: true,
    ));

    expect(view.title, 'SAFE PRODUCTION PROOF: FAIL');
    expect(view.isPass, false);
    expect(view.isTerminal, true);
  });

  test('finished dry-run boundary without production error is PASS', () {
    final view = classifySafeProofStatus(proofData(
      status: 'finished',
      state: 'finished',
      result: 'DRY_RUN_PREBOOK_REACHED',
      boundaryReached: true,
    ));

    expect(view.title, 'SAFE PRODUCTION PROOF: PASS');
    expect(view.isPass, true);
    expect(view.isTerminal, true);
  });

  test('proof lock remains held until terminal state', () {
    expect(classifySafeProofStatus(proofData(state: 'ready')).isTerminal, false);
    expect(classifySafeProofStatus(proofData(state: 'booking')).isTerminal, false);
    expect(
      classifySafeProofStatus(proofData(
        status: 'finished',
        state: 'finished',
        result: 'DRY_RUN_PREBOOK_REACHED',
        boundaryReached: true,
      )).isTerminal,
      true,
    );
    expect(
      classifySafeProofStatus(proofData(status: 'error', state: 'error')).isTerminal,
      true,
    );
  });
}
