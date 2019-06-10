import { OptionFilters, filterCommandLineOptions, filterCommandLineOptionsByGroup, unparseArgs } from '@ionic/cli-framework';

import { CommandLineInputs, CommandLineOptions, CommandMetadata, CommandMetadataOption } from '../../../definitions';

/**
 * Filter and gather arguments from command line to be passed to Cordova
 */
export function filterArgumentsForCordova(metadata: CommandMetadata, options: CommandLineOptions): string[] {
  const m = { ...metadata };

  if (!m.options) {
    m.options = [];
  }

  const globalCordovaOpts: CommandMetadataOption[] = [
    {
      name: 'verbose',
      summary: '',
      type: Boolean,
      groups: ['cordova-cli'],
    },
    {
      name: 'nosave',
      summary: '',
      type: Boolean,
      groups: ['cordova-cli'],
    },
  ];

  m.options.push(...globalCordovaOpts);

  const results = filterCommandLineOptionsByGroup(m.options, options, 'cordova-cli');

  const args = unparseArgs(results, { useEquals: false, allowCamelCase: true });
  const i = args.indexOf('--');

  if (i >= 0) {
    args.splice(i, 1); // join separated args onto main args, use them verbatim
  }

  return [m.name, ...args];
}

export function generateOptionsForCordovaBuild(metadata: CommandMetadata, inputs: CommandLineInputs, options: CommandLineOptions): CommandLineOptions {
  const platform = inputs[0] ? inputs[0] : (options['platform'] ? String(options['platform']) : undefined);
  const project = options['project'] ? String(options['project']) : undefined;

  // iOS does not support port forwarding out-of-the-box like Android does.
  // See https://github.com/ionic-team/native-run/issues/20
  const externalAddressRequired = platform === 'ios' || !options['native-run'];

  const includesAppScriptsGroup = OptionFilters.includesGroups('app-scripts');
  const excludesCordovaGroup = OptionFilters.excludesGroups('cordova-cli');
  const results = filterCommandLineOptions(metadata.options ? metadata.options : [], options, o => excludesCordovaGroup(o) || includesAppScriptsGroup(o));

  return {
    ...results,
    externalAddressRequired,
    nobrowser: true,
    engine: 'cordova',
    platform,
    project,
  };
}
