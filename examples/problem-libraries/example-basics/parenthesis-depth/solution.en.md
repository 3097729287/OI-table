Scan from left to right. Increase the current depth on `(` and decrease it on `)`. The current depth counts unmatched opening parentheses, so its largest value during the scan is the answer.

The running time is $O(n)$ with $O(1)$ auxiliary space.
