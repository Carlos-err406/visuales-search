#!/usr/bin/env sh
set -eu

DOMAIN="${VISUALES_ROUTE_DOMAIN:-visuales.uclv.cu}"
INTERFACE="${VISUALES_ROUTE_INTERFACE:-en0}"
ACTION="${1:-status}"

gateway() {
  if [ "${VISUALES_ROUTE_GATEWAY:-}" ]; then
    echo "$VISUALES_ROUTE_GATEWAY"
    return
  fi

  default_route="$(route -n get default)"
  default_interface="$(printf "%s\n" "$default_route" | awk '/interface:/ { print $2; exit }')"
  default_gateway="$(printf "%s\n" "$default_route" | awk '/gateway:/ { print $2; exit }')"

  if [ "$default_gateway" ] && ! printf "%s\n" "$default_interface" | grep -q '^utun'; then
    echo "$default_gateway"
    return
  fi

  ipconfig getoption "$INTERFACE" router
}

ips() {
  dig +short "$DOMAIN" | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print }' | sort -u
}

usage() {
  echo "Usage: $0 apply|reverse|status"
  echo
  echo "Environment overrides:"
  echo "  VISUALES_ROUTE_DOMAIN=$DOMAIN"
  echo "  VISUALES_ROUTE_INTERFACE=$INTERFACE"
  echo "  VISUALES_ROUTE_GATEWAY=$(gateway)"
}

apply_route() {
  ip="$1"
  gateway="$2"

  if route -n get "$ip" 2>/dev/null | grep -q "gateway: $gateway"; then
    echo "already routed: $ip -> $gateway"
    return
  fi

  if sudo route add -host "$ip" "$gateway" 2>/dev/null; then
    echo "added: $ip -> $gateway"
  else
    sudo route change -host "$ip" "$gateway"
    echo "changed: $ip -> $gateway"
  fi
}

reverse_route() {
  ip="$1"
  gateway="$2"

  if sudo route delete -host "$ip" "$gateway" 2>/dev/null; then
    echo "deleted: $ip -> $gateway"
  else
    echo "not present: $ip -> $gateway"
  fi
}

status_route() {
  ip="$1"

  echo "$ip"
  route -n get "$ip" 2>/dev/null | awk '/gateway:|interface:/ { print "  " $0 }' || echo "  no route"
}

case "$ACTION" in
  apply)
    GATEWAY="$(gateway)"
    if [ -z "$GATEWAY" ]; then
      echo "Could not detect gateway. Set VISUALES_ROUTE_GATEWAY manually." >&2
      exit 1
    fi
    ips | while IFS= read -r ip; do
      apply_route "$ip" "$GATEWAY"
    done
    ;;
  reverse | revert | remove)
    GATEWAY="$(gateway)"
    if [ -z "$GATEWAY" ]; then
      echo "Could not detect gateway. Set VISUALES_ROUTE_GATEWAY manually." >&2
      exit 1
    fi
    ips | while IFS= read -r ip; do
      reverse_route "$ip" "$GATEWAY"
    done
    ;;
  status)
    ips | while IFS= read -r ip; do
      status_route "$ip"
    done
    ;;
  -h | --help | help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
