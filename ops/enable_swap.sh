#!/usr/bin/env bash
set -euo pipefail

SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE="${SWAP_SIZE:-4G}"
SWAPPINESS="${SWAPPINESS:-10}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root."
  exit 1
fi

if ! swapon --show | grep -q "${SWAP_FILE}"; then
  if [[ ! -f "${SWAP_FILE}" ]]; then
    fallocate -l "${SWAP_SIZE}" "${SWAP_FILE}"
    chmod 600 "${SWAP_FILE}"
    mkswap "${SWAP_FILE}"
  fi
  swapon "${SWAP_FILE}"
fi

if ! grep -q "^${SWAP_FILE} " /etc/fstab; then
  echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
fi

cat >/etc/sysctl.d/99-logtudo-memory.conf <<EOF
vm.swappiness=${SWAPPINESS}
EOF
sysctl -p /etc/sysctl.d/99-logtudo-memory.conf

echo "Swap configurado:"
free -h
swapon --show
