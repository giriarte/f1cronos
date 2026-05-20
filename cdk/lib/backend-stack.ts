import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3assets from 'aws-cdk-lib/aws-s3-assets'
import { Construct } from 'constructs'
import * as path from 'path'

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ── Bundle backend/ source as an S3 asset ──────────────────────────────
    const backendAsset = new s3assets.Asset(this, 'BackendAsset', {
      path: path.join(__dirname, '../../backend'),
      exclude: ['venv', 'cache', '__pycache__', '*.pyc', '.env'],
    })

    // ── Default VPC ────────────────────────────────────────────────────────
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true })

    // ── Security group ─────────────────────────────────────────────────────
    const sg = new ec2.SecurityGroup(this, 'BackendSg', {
      vpc,
      description: 'F1 Cronos backend',
      allowAllOutbound: true,
    })
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80),  'HTTP')
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS')
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22),  'SSH (optional)')

    // ── IAM role ───────────────────────────────────────────────────────────
    const role = new iam.Role(this, 'BackendRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    })
    backendAsset.grantRead(role)

    // ── AMI: Amazon Linux 2023 ─────────────────────────────────────────────
    const ami = ec2.MachineImage.latestAmazonLinux2023()

    // ── User data ──────────────────────────────────────────────────────────
    const userData = ec2.UserData.forLinux()
    userData.addCommands(
      // system updates
      'dnf update -y',
      'dnf install -y python3.11 python3.11-pip nginx aws-cli unzip',

      // download & extract backend asset
      `aws s3 cp "${backendAsset.s3ObjectUrl}" /tmp/backend.zip`,
      'mkdir -p /opt/f1cronos',
      'cd /opt/f1cronos && unzip -o /tmp/backend.zip',

      // Python virtualenv + deps
      'python3.11 -m venv /opt/f1cronos/venv',
      '/opt/f1cronos/venv/bin/pip install --upgrade pip',
      '/opt/f1cronos/venv/bin/pip install -r /opt/f1cronos/requirements.txt',

      // FastF1 cache directory
      'mkdir -p /opt/f1cronos/cache',
      'chown -R nobody:nobody /opt/f1cronos/cache',

      // ── systemd service ─────────────────────────────────────────────────
      'cat > /etc/systemd/system/f1cronos.service << \'EOF\'',
      '[Unit]',
      'Description=F1 Cronos FastAPI backend',
      'After=network.target',
      '',
      '[Service]',
      'User=nobody',
      'WorkingDirectory=/opt/f1cronos',
      'ExecStart=/opt/f1cronos/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000',
      'Restart=always',
      'RestartSec=5',
      'Environment=HOME=/tmp',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',

      'systemctl daemon-reload',
      'systemctl enable f1cronos',
      'systemctl start f1cronos',

      // ── nginx reverse proxy ──────────────────────────────────────────────
      'cat > /etc/nginx/conf.d/f1cronos.conf << \'EOF\'',
      '# Rate limiting: 10 req/s per IP, burst of 20, excess → 503',
      'limit_req_zone  $binary_remote_addr zone=api:10m  rate=10r/s;',
      '# Connection limiting: max 10 simultaneous connections per IP',
      'limit_conn_zone $binary_remote_addr zone=conn:10m;',
      '',
      'server {',
      '    listen 80;',
      '    server_name _;',
      '',
      '    location / {',
      '        limit_req  zone=api  burst=20 nodelay;',
      '        limit_conn conn 10;',
      '',
      '        proxy_pass         http://127.0.0.1:8000;',
      '        proxy_http_version 1.1;',
      '        proxy_set_header   Upgrade $http_upgrade;',
      '        proxy_set_header   Connection "upgrade";',
      '        proxy_set_header   Host $host;',
      '        proxy_set_header   X-Real-IP $remote_addr;',
      '        proxy_read_timeout 3600s;',
      '    }',
      '}',
      'EOF',

      // remove default nginx config so our server block wins
      'rm -f /etc/nginx/conf.d/default.conf',
      'systemctl enable nginx',
      'systemctl restart nginx',
    )

    // ── EC2 instance ───────────────────────────────────────────────────────
    const instance = new ec2.Instance(this, 'BackendInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ami,
      securityGroup: sg,
      role,
      userData,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(20, { volumeType: ec2.EbsDeviceVolumeType.GP3 }),
      }],
    })

    // ── Elastic IP ─────────────────────────────────────────────────────────
    const eip = new ec2.CfnEIP(this, 'BackendEip', { domain: 'vpc' })
    new ec2.CfnEIPAssociation(this, 'BackendEipAssoc', {
      allocationId: eip.attrAllocationId,
      instanceId:   instance.instanceId,
    })

    // ── Outputs ────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'BackendUrl', {
      value:       `http://${eip.ref}`,
      description: 'Backend HTTP URL — set as VITE_API_URL in Amplify',
      exportName:  'F1CronosBackendUrl',
    })

    new cdk.CfnOutput(this, 'InstanceId', {
      value:       instance.instanceId,
      description: 'EC2 instance ID (use with SSM Session Manager)',
    })
  }
}
