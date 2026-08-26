#!/bin/bash
# custom-cont-init.d script for the linuxserver/openssh-server container:
# starts a TigerVNC server (installed via universal-package-install mod) on
# display :1 / port 5901 with classic VNC auth, for sshdeck's VNC tests.
set -e

# The image ships AllowTcpForwarding no; sshdeck's VNC tunnel (and ProxyJump)
# needs direct-tcpip channels. This runs before sshd starts, so no restart.
sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /config/sshd/sshd_config /etc/ssh/sshd_config

mkdir -p /config/.vnc
printf 'testvncpass' | vncpasswd -f > /config/.vnc/passwd
chmod 600 /config/.vnc/passwd

nohup Xvnc :1 \
  -rfbport 5901 \
  -PasswordFile /config/.vnc/passwd \
  -SecurityTypes VncAuth \
  -geometry 1280x800 \
  -depth 24 \
  > /tmp/xvnc.log 2>&1 &

echo "vnc-init: Xvnc started on :1 (port 5901)"
