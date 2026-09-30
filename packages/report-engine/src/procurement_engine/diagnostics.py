"""Evidence projection stored alongside executive documents, never in their body."""


def project_diagnostics(model):
    fields = ('snapshot', 'report_clock', 'metric_semantics', 'period_contract', 'issues',
              'identity_observations', 'release', 'independent_audit', 'trace_records', 'formula_dependencies')
    return {'version': 'diagnostic-protocol-v1', **{key: model[key] for key in fields},
            'recommendations': model['recommendation_records']}
