export const ENTRY_TEMPLATE = `
# [{{ entry.name }}]({{ entry.webURL }})

* id: {{ entry.id }}
* displayId: {{ entry.displayId }}
* folderId: {{ entry.folderId }}
* createdAt: {{ entry.createdAt }}
* modifiedAt: {{ entry.modifiedAt }}

## Authors
{% for author in entry.authors %}
* {{ author.name }}
  * id: {{ author.id }}
  * handle: {{ author.handle }}
{%- endfor %}

## Schema

* id: {{ entry.schema.id }}
* name: {{ entry.schema.name }}

## Fields
{% for name, value in entry.fields.items() %}
* {{ name }}: {{ value.displayValue }}
{%- endfor %}

## Custom fields
{% for name, value in entry.customFields.items() %}
* {{ name }}: {{ value.value }}
{%- endfor %}
`;
