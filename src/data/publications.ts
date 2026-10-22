export interface Publication {
  cves: string[];
  date: string;
  displayDate: string;
  product: string;
  title: string;
  summary: string;
  advisory: string;
  authors: { name: string; url?: string }[];
  references: { label: string; url: string }[];
}

const pasquale = { name: "Pasquale ‘sid’ Fiorillo", url: 'https://www.linkedin.com/in/pasqualefiorillo/' };

export const publications: Publication[] = [
  {
    cves: ['CVE-2025-34324', 'CVE-2025-34327'],
    date: '2025-11-14', displayDate: '14 NOV 2025',
    product: 'GoSign Desktop',
    title: 'Multiple Vulnerabilities in GoSign Desktop Lead to Remote Code Execution',
    summary: 'When configured to use a proxy, GoSign Desktop 2.4.0 and earlier disables TLS certificate validation and relies on unsigned update manifests, allowing remote code execution, credential theft, and privilege escalation.',
    advisory: 'https://www.ush.it/2025/11/14/multiple-vulnerabilities-gosign-desktop-remote-code-execution/',
    authors: [pasquale, { name: "Francesco ‘ascii’ Ongaro", url: 'https://www.linkedin.com/in/ongaro/' }, { name: 'Marco Lunardi', url: 'https://www.linkedin.com/in/marco-lunardi-480b201a2' }],
    references: [
      { label: 'InfoCert · Release notes · November 2025', url: 'https://help.infocert.it/Home/Guida/release-note-infocert-sign-novembre-2025' },
      { label: 'InfoCert · Release notes · January 2026', url: 'https://help.infocert.it/Home/Guida/release-note-infocert-sign---gennaio-2026' },
      { label: 'U.S.H. · Original article', url: 'https://www.ush.it/2025/11/14/multiple-vulnerabilities-gosign-desktop-remote-code-execution/' },
      { label: 'U.S.H. · Technical advisory', url: 'https://www.ush.it/team/ush/hack-gosign-desktop_240/gosign-desktop-exec.txt' },
      { label: 'NIST · CVE-2025-34324 · Insecure update', url: 'https://nvd.nist.gov/vuln/detail/CVE-2025-34324' },
      { label: 'NIST · CVE-2025-34327 · Missing TLS validation', url: 'https://nvd.nist.gov/vuln/detail/CVE-2025-34327' },
    ],
  },
  {
    cves: [],
    date: '2024-05-23', displayDate: '23 MAY 2024',
    product: 'TLS & DDNS',
    title: 'Usage of TLS in DDNS Services Leads to Information Disclosure in Multiple Vendors',
    summary: 'Using TLS certificates with vendor-provided Dynamic DNS services exposes device hostnames in public Certificate Transparency logs, making customer appliances easier for attackers to discover.',
    advisory: 'https://www.ush.it/2024/05/23/tls-ddns-multiple-vendor-information-disclosure/',
    authors: [pasquale],
    references: [
      { label: 'U.S.H. · Original article (English)', url: 'https://www.ush.it/2024/05/23/tls-ddns-multiple-vendor-information-disclosure/' },
      { label: 'Personal blog · Italian version', url: 'https://blog.pasqualefiorillo.it/usage-of-tls-in-ddns-services-leads-to-information-disclosure-in-multiple-vendors/' },
    ],
  },
  {
    cves: ['CVE-2017-5227'], date: '2017-03-22', displayDate: '22 MAR 2017',
    product: 'QNAP QTS', title: 'QNAP QTS Domain Privilege Escalation Vulnerability',
    summary: 'A vulnerability in QNAP QTS allows a local user, such as the httpdusr account used by web applications, to escalate privileges to Domain Administrator when the NAS is joined to a domain.',
    advisory: '/resources/qnap.txt',
    authors: [pasquale, { name: "Guido ‘go’ Oricchio", url: 'https://www.linkedin.com/in/pcego/' }],
    references: [
      { label: 'QNAP · Security bulletin & credits', url: 'https://www.qnap.com/en/security-advisory/nas-201703-21' },
      { label: 'U.S.H. · Original advisory', url: 'https://www.ush.it/team/ush/hack-qnap/qnap.txt' },
      { label: 'SecurityFocus', url: 'http://www.securityfocus.com/bid/97056' },
      { label: 'Full Disclosure', url: 'http://seclists.org/fulldisclosure/2017/Mar/60' },
      { label: 'Exploit Database', url: 'https://www.exploit-db.com/exploits/41745/' },
      { label: 'Security Affairs', url: 'http://securityaffairs.co/wordpress/57387/hacking/qnap-qts-flaw.html' },
      { label: 'U.S.H. · Research article', url: 'http://www.ush.it/2017/03/22/qnap-qts-domain-privilege-escalation-vulnerability/' },
      { label: 'MITRE · CVE record', url: 'http://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2017-5227' },
      { label: 'NIST · National Vulnerability Database', url: 'https://nvd.nist.gov/vuln/detail/CVE-2017-5227' },
    ],
  },
  {
    cves: ['CVE-2015-5742'], date: '2015-10-08', displayDate: '08 OCT 2015',
    product: 'Veeam Backup & Replication', title: 'Veeam Backup & Replication Local Privilege Escalation Vulnerability',
    summary: 'A vulnerability in Veeam Backup & Replication allows a low-privileged local Windows user, such as an anonymous IIS virtual host account, to escalate privileges to Domain Administrator.',
    advisory: '/resources/veeam.txt',
    authors: [pasquale, { name: "Francesco ‘ascii’ Ongaro", url: 'https://www.linkedin.com/in/ongaro/' }, { name: "Antonio ‘s4tan’ Parata", url: 'https://www.linkedin.com/in/antonioparata/' }],
    references: [
      { label: 'Veeam · Release notes & credits', url: 'https://www.veeam.com/kb2068' },
      { label: 'Veeam · Security bulletin', url: 'https://www.veeam.com/kb2180' },
      { label: 'U.S.H. · Original advisory', url: 'http://www.ush.it/team/ush/hack-veeam_6_7_8/veeam.txt' },
      { label: 'SecurityFocus', url: 'http://www.securityfocus.com/bid/77035/' },
      { label: 'Full Disclosure', url: 'http://seclists.org/fulldisclosure/2015/Oct/44' },
      { label: 'Bugtraq', url: 'http://seclists.org/bugtraq/2015/Oct/51' },
      { label: 'Packet Storm', url: 'https://packetstormsecurity.com/files/133906/Veeam-Backup-And-Replication-6-7-8-Privilege-Escalation.html' },
      { label: 'Security Affairs', url: 'http://securityaffairs.co/wordpress/40891/hacking/veeam-zero-day.html' },
      { label: 'Ethical Hacking', url: 'http://www.ethical-hacking.it/a-good-time-to-update-your-veeam-to-update-3-veeamvixproxy-vulnerability/' },
      { label: 'U.S.H. · Research article', url: 'http://www.ush.it/2015/10/08/veeam-backup-replication-6-7-8-local-privilege-escalation-vulnerability/' },
      { label: 'MITRE · CVE record', url: 'http://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2015-5742' },
      { label: 'NIST · National Vulnerability Database', url: 'https://nvd.nist.gov/vuln/detail/CVE-2015-5742' },
    ],
  },
];
