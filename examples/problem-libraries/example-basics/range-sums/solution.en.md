Set $s_0=0$ and compute $s_i=s_{i-1}+a_i$. The answer for $[l,r]$ is $s_r-s_{l-1}$, since the subtraction cancels all entries before $l$.

Store the prefix sums in 64-bit integers. The running time is $O(n+q)$ and the space usage is $O(n)$.

## Reference implementations

```cpp example=prefix-sums title="C++ · Prefix loop"
#include <iostream>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, q;
    if (!(std::cin >> n >> q)) return 0;

    std::vector<long long> prefix(n + 1);
    for (int i = 1; i <= n; ++i) {
        long long value;
        std::cin >> value;
        prefix[i] = prefix[i - 1] + value;
    }

    while (q--) {
        int left, right;
        std::cin >> left >> right;
        std::cout << prefix[right] - prefix[left - 1] << '\n';
    }
}
```

```python example=prefix-sums title="Python · Prefix loop"
import sys

read = sys.stdin.buffer.readline
n, q = map(int, read().split())
prefix = [0]
for value in map(int, read().split()):
    prefix.append(prefix[-1] + value)

answers = []
for _ in range(q):
    left, right = map(int, read().split())
    answers.append(str(prefix[right] - prefix[left - 1]))

sys.stdout.write("\n".join(answers) + "\n")
```

```python example=prefix-sums title="Python · accumulate"
import sys
from itertools import accumulate

read = sys.stdin.buffer.readline
n, q = map(int, read().split())
prefix = list(accumulate(map(int, read().split()), initial=0))

answers = []
for _ in range(q):
    left, right = map(int, read().split())
    answers.append(str(prefix[right] - prefix[left - 1]))

sys.stdout.write("\n".join(answers) + "\n")
```
