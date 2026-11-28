令 $s_0=0$，并计算 $s_i=s_{i-1}+a_i$。询问 $[l,r]$ 的答案为 $s_r-s_{l-1}$，因为相减消去了第 $l$ 项之前的所有项。

使用 64 位整数保存前缀和。时间复杂度为 $O(n+q)$，空间复杂度为 $O(n)$。

## 参考代码

```cpp example=prefix-sums title="C++ · 手写前缀和"
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

```python example=prefix-sums title="Python · 手写前缀和"
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
