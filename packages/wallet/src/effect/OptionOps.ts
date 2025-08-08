import { JsOption, ScalaOption } from '@midnight-ntwrk/wallet';
import { Option } from 'effect';

export const fromScala = <A>(scalaOption: ScalaOption<A>): Option.Option<A> => {
  const result = JsOption.asResult(scalaOption);

  return result ? Option.some(result) : Option.none();
};
