# micromark-extension-math

This fork is to find a more tolerant way to recognize block math.

Remark-math will only recognize the math block only when both `$$` are stand-alone.

For example,

```markdown
$$
some math
$$
```

When it comes to

```markdown
$$some math
$$
```

-> this will lead to nothing.

OR

```markdown
$$
some math$$
```

-> this math block will never end.

This fork will solve the problem.
