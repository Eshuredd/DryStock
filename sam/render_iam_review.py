"""Resolve the review template's IAM documents locally, without AWS calls."""
import argparse
import json
import re
from pathlib import Path
import yaml


class TemplateLoader(yaml.SafeLoader):
    pass


def intrinsic(loader, suffix, node):
    value = loader.construct_scalar(node) if isinstance(node, yaml.ScalarNode) else loader.construct_sequence(node)
    return {suffix: value}


TemplateLoader.add_multi_constructor('!', intrinsic)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--account', required=True)
    parser.add_argument('--region', default='ap-south-1')
    parser.add_argument('--principal', default='arn:aws:iam::ACCOUNT:role/OWNER_APPROVED_SSO_ROLE')
    args = parser.parse_args()
    if not re.fullmatch(r'\d{12}', args.account):
        raise SystemExit('A 12-digit account ID is required; do not provide credentials')
    root = Path(__file__).resolve().parent
    template = yaml.load((root/'bootstrap-template.yaml').read_text(), Loader=TemplateLoader)
    values = {'AWS::AccountId': args.account, 'AWS::Region': args.region,
        'DeploymentPrincipalArn': args.principal.replace('ACCOUNT', args.account)}
    refs = {'RuntimeRole.Arn': f'arn:aws:iam::{args.account}:role/drystock-demo-runtime',
        'CloudFormationRole.Arn': f'arn:aws:iam::{args.account}:role/drystock-demo-cloudformation',
        'Images.Arn': f'arn:aws:ecr:{args.region}:{args.account}:repository/drystock-demo',
        'Artifacts.Arn': f'arn:aws:s3:::drystock-demo-artifacts-{args.account}-{args.region}'}

    def resolve(value):
        if isinstance(value, list):
            return [resolve(v) for v in value]
        if not isinstance(value, dict):
            return value
        if 'Ref' in value:
            return values[value['Ref']]
        if 'GetAtt' in value:
            return refs[value['GetAtt']]
        if 'Sub' in value:
            return re.sub(r'\$\{([^}]+)\}', lambda m: values.get(m[1], refs.get(m[1], m[0])), value['Sub'])
        return {key: resolve(item) for key, item in value.items()}

    destination = root/'iam-review'
    destination.mkdir(exist_ok=True)
    for name, filename in [('DeployRole', 'deployment'), ('CloudFormationRole', 'cloudformation'), ('RuntimeRole', 'runtime')]:
        properties = template['Resources'][name]['Properties']
        policy = resolve(properties['Policies'][0]['PolicyDocument'])
        trust = resolve(properties['AssumeRolePolicyDocument'])
        (destination/f'{filename}-policy.json').write_text(json.dumps(policy, indent=2)+'\n')
        (destination/f'{filename}-trust.json').write_text(json.dumps(trust, indent=2)+'\n')
    source = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Action': 'sts:AssumeRole',
        'Resource': f'arn:aws:iam::{args.account}:role/drystock-deploy'}]}
    (destination/'source-assume-role-policy.json').write_text(json.dumps(source, indent=2)+'\n')
    print('Seven review JSON files written. No credentials, IAM changes or AWS calls.')
