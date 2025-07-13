/**
 * @import {Construct, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
 */

import {ok as assert} from 'devlop'
import {factorySpace} from 'micromark-factory-space'
import {markdownLineEnding} from 'micromark-util-character'
import {codes, constants, types} from 'micromark-util-symbol'

/** @type {Construct} */
export const mathFlow = {
  tokenize: tokenizeMathFenced,
  concrete: true,
  name: 'mathFlow'
}

/** @type {Construct} */
const nonLazyContinuation = {
  tokenize: tokenizeNonLazyContinuation,
  partial: true
}

/**
 * A tokenizer for a closing fence that can appear midline.
 * It does not handle line prefixes and is more lenient about what follows.
 * @type {Tokenizer}
 */
function tokenizeClosingFenceMidline(effects, ok, nok) {
  const self = this
  let size = 0

  // This tokenizer is simpler because it doesn't need to handle indentation/prefixes.
  return sequenceStart

  /** @type {State} */
  function sequenceStart(code) {
    // Must start with a dollar.
    if (code !== codes.dollarSign) {
      return nok(code)
    }
    effects.enter('mathFlowFence')
    effects.enter('mathFlowFenceSequence')
    return sequenceClose(code)
  }

  /** @type {State} */
  function sequenceClose(code) {
    if (code === codes.dollarSign) {
      size++
      effects.consume(code)
      return sequenceClose
    }

    // @ts-expect-error - `sizeOpen` is defined in the parent tokenizer's scope.
    if (size < self.sizeOpen) {
      return nok(code)
    }

    effects.exit('mathFlowFenceSequence')
    effects.exit('mathFlowFence')
    // Successfully found a closing fence. Any character can follow.
    return ok(code)
  }
}

/**
 * @this {TokenizeContext}
 * @type {Tokenizer}
 */
function tokenizeMathFenced(effects, ok, nok) {
  const self = this
  const tail = self.events[self.events.length - 1]
  const initialSize =
    tail && tail[1].type === types.linePrefix
      ? tail[2].sliceSerialize(tail[1], true).length
      : 0
  let sizeOpen = 0

  // Pass sizeOpen to the helper tokenizer through the context.
  // @ts-expect-error
  self.sizeOpen = sizeOpen

  return start

  /**
   * Start of math.
   *
   * @type {State}
   */
  function start(code) {
    assert(code === codes.dollarSign, 'expected `$`')
    effects.enter('mathFlow')
    effects.enter('mathFlowFence')
    effects.enter('mathFlowFenceSequence')
    return sequenceOpen(code)
  }

  /**
   * In opening fence sequence.
   *
   * @type {State}
   */
  function sequenceOpen(code) {
    if (code === codes.dollarSign) {
      effects.consume(code)
      sizeOpen++
      return sequenceOpen
    }

    if (sizeOpen < 2) {
      return nok(code)
    }
    // @ts-expect-error
    self.sizeOpen = sizeOpen

    effects.exit('mathFlowFenceSequence')
    return factorySpace(effects, metaBefore, types.whitespace)(code)
  }

  /**
   * In opening fence, before meta.
   *
   * @type {State}
   */

  function metaBefore(code) {
    // MODIFICATION: Handle content on the same line as the opening fence.
    if (code !== codes.eof && !markdownLineEnding(code)) {
      effects.exit('mathFlowFence')
      effects.enter('mathFlowValue')
      return contentChunk(code)
    }
    // Original behavior: empty line after the fence.
    return metaAfter(code)
  }

  /**
   * After meta.
   *
   * @type {State}
   */
  function metaAfter(code) {
    // Guaranteed to be eol/eof.
    effects.exit('mathFlowFence')

    if (self.interrupt) {
      return ok(code)
    }

    return effects.attempt(
      nonLazyContinuation,
      beforeNonLazyContinuation,
      after
    )(code)
  }

  /**
   * After eol/eof in math, at a non-lazy closing fence or content.
   *
   * @type {State}
   */
  function beforeNonLazyContinuation(code) {
    return effects.attempt(
      {tokenize: tokenizeClosingFence, partial: true},
      after,
      contentStart
    )(code)
  }

  /**
   * Before math content, definitely not before a closing fence.
   *
   * @type {State}
   */
  function contentStart(code) {
    return (
      initialSize
        ? factorySpace(
            effects,
            beforeContentChunk,
            types.linePrefix,
            initialSize + 1
          )
        : beforeContentChunk
    )(code)
  }

  /**
   * Before math content, after optional prefix.
   *
   * @type {State}
   */
  function beforeContentChunk(code) {
    if (code === codes.eof) {
      return after(code)
    }

    if (markdownLineEnding(code)) {
      return effects.attempt(
        nonLazyContinuation,
        beforeNonLazyContinuation,
        after
      )(code)
    }

    effects.enter('mathFlowValue')
    return contentChunk(code)
  }

  /**
   * In math content.
   *
   * @type {State}
   */
  function contentChunk(code) {
    // MODIFICATION: Check for a closing fence at any point.
    if (code === codes.dollarSign) {
      effects.exit('mathFlowValue')
      return attemptClosingFenceMidline(code)
    }

    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit('mathFlowValue')
      return beforeContentChunk(code)
    }

    effects.consume(code)
    return contentChunk
  }

  /**
   * A new state to attempt parsing a midline closing fence.
   * @type {State}
   */
  function attemptClosingFenceMidline(code) {
    return effects.attempt(
      {tokenize: tokenizeClosingFenceMidline, partial: true},
      after,
      failedMidlineAttempt
    )(code)
  }

  /**
   * A new state for when the midline closing fence attempt fails.
   * @type {State}
   */
  function failedMidlineAttempt(code) {
    // The attempt failed. The character is not part of a fence.
    // Re-enter the value state, consume the character, and continue content parsing.
    effects.enter('mathFlowValue')
    effects.consume(code)
    return contentChunk
  }

  /**
   * After math (ha!).
   *
   * @type {State}
   */
  function after(code) {
    effects.exit('mathFlow')
    return ok(code)
  }

  /** @type {Tokenizer} */
  function tokenizeClosingFence(effects, ok, nok) {
    let size = 0

    assert(self.parser.constructs.disable.null, 'expected `disable.null`')
    return factorySpace(
      effects,
      beforeSequenceClose,
      types.linePrefix,
      self.parser.constructs.disable.null.includes('codeIndented')
        ? undefined
        : constants.tabSize
    )

    /**
     * @type {State}
     */
    function beforeSequenceClose(code) {
      effects.enter('mathFlowFence')
      effects.enter('mathFlowFenceSequence')
      return sequenceClose(code)
    }

    /**
     * @type {State}
     */
    function sequenceClose(code) {
      if (code === codes.dollarSign) {
        size++
        effects.consume(code)
        return sequenceClose
      }

      if (size < sizeOpen) {
        return nok(code)
      }

      effects.exit('mathFlowFenceSequence')
      return factorySpace(effects, afterSequenceClose, types.whitespace)(code)
    }

    /**
     * @type {State}
     */
    function afterSequenceClose(code) {
      if (code === codes.eof || markdownLineEnding(code)) {
        effects.exit('mathFlowFence')
        return ok(code)
      }

      return nok(code)
    }
  }
}

/**
 * @this {TokenizeContext}
 * @type {Tokenizer}
 */
function tokenizeNonLazyContinuation(effects, ok, nok) {
  const self = this

  return start

  /** @type {State} */
  function start(code) {
    if (code === null) {
      return ok(code)
    }

    assert(markdownLineEnding(code), 'expected eol')
    effects.enter(types.lineEnding)
    effects.consume(code)
    effects.exit(types.lineEnding)
    return lineStart
  }

  /** @type {State} */
  function lineStart(code) {
    return self.parser.lazy[self.now().line] ? nok(code) : ok(code)
  }
}
