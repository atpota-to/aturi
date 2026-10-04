#!/usr/bin/env sh
# Syntax-checks every Swift file in the app and share-extension targets with
# the compiler's parser only. SwiftUI, UIKit and CryptoKit do not exist on
# Linux, so this is as far as a non-Apple machine can take those targets: it
# catches unbalanced braces, bad literals and malformed declarations, and
# nothing about types. A full compile needs Xcode (or the `ios` CI job).
#
#   sh ios/scripts/parse-check.sh
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
status=0
count=0
for file in $(find "$root/Aturi" "$root/AturiShare" -name '*.swift' | sort); do
  count=$((count + 1))
  if ! swiftc -parse "$file" 2>/tmp/aturi-parse-check.log; then
    status=1
    echo "parse error: ${file#"$root/"}"
    cat /tmp/aturi-parse-check.log
  fi
done
rm -f /tmp/aturi-parse-check.log
echo "parsed $count files"
exit $status
