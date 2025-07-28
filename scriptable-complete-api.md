# Scriptable API Reference

This document contains comprehensive API documentation for Scriptable. Each class is organized with its description, constructor, methods, and properties clearly documented.

## Table of Contents

- [CallbackURL](#callbackurl)
- [Alert](#alert)
- [Calendar](#calendar)
- [CalendarEvent](#calendarevent)
- [Color](#color)
- [Contact](#contact)
- [ContactsContainer](#contactscontainer)
- [ContactsGroup](#contactsgroup)
- [Data](#data)
- [DateFormatter](#dateformatter)
- [DatePicker](#datepicker)
- [Device](#device)
- [Dictation](#dictation)
- [DocumentPicker](#documentpicker)
- [DrawContext](#drawcontext)
- [FileManager](#filemanager)
- [Font](#font)
- [Image](#image)
- [Keychain](#keychain)
- [LinearGradient](#lineargradient)
- [ListWidget](#listwidget)
- [Location](#location)
- [Mail](#mail)
- [Message](#message)
- [Notification](#notification)
- [Pasteboard](#pasteboard)
- [Path](#path)
- [Photos](#photos)
- [Point](#point)
- [QuickLook](#quicklook)
- [Rect](#rect)
- [RecurrenceRule](#recurrencerule)
- [RelativeDateTimeFormatter](#relativedatetimeformatter)
- [Reminder](#reminder)
- [Request](#request)
- [SFSymbol](#sfsymbol)
- [Safari](#safari)
- [Script](#script)
- [ShareSheet](#sharesheet)
- [Size](#size)
- [Speech](#speech)
- [TextField](#textfield)
- [Timer](#timer)
- [UITable](#uitable)
- [UITableCell](#uitablecell)
- [UITableRow](#uitablerow)
- [URLScheme](#urlscheme)
- [UUID](#uuid)
- [WebView](#webview)
- [WidgetDate](#widgetdate)
- [WidgetImage](#widgetimage)
- [WidgetSpacer](#widgetspacer)
- [WidgetStack](#widgetstack)
- [WidgetText](#widgettext)
- [XMLParser](#xmlparser)

---

## CallbackURL

Open x-callback-url requests.

Opens apps that support x-callback-url and waits for a response from the target application. You can find a list of apps that support x-callback-url at [x-callback-url.com/apps](http://x-callback-url.com/apps/).

### Constructor

#### `new CallbackURL(baseURL: string)`

Constructs an object that opens x-callback-url requests and waits for a response from the target app.

**Parameters:**
- `baseURL` (string): Base URL of the request. This is usually something like my-app://x-callback-url/action

### Methods

#### `addParameter(name: string, value: string)`

Appends a key/value pair to the base URL as a query parameter. The name and value are automatically encoded. Do not add the x-callback-url parameters, i.e. x-source, x-success, x-error and x-cancel as Scriptable will add those.

**Parameters:**
- `name` (string): Name of the query parameter to add.
- `value` (string): Value of the query parameter to add.

#### `open(): Promise<{string: string}>`

Opens the callback URL.

Opens the target app and waits for the target app to perform the action. The returned promise contains the query parameters supplied by the target app when it invokes the callback. If the action failed in the target app or the action was cancelled, the promise will be rejected. The promise is also rejected if the action times out because the target app did not invoke the callback.

**Return value:**
- `Promise<{string: string}>`: Promise that provides the query parameters supplied by the target app when it invokes the callback.

#### `getURL(): string`

Creates the callback URL.

Creates a callback URL with the specified base URL and query parameters.

**Return value:**
- `string`: Configured callback URL.

---

## Alert

Presents an alert.

Use this to configure an alert presented modally or as a sheet. After configuring the alert, call presentAlert() or presentSheet() to present the alert. The two presentations methods will return a value which carries the index of the action that was selected when fulfilled.

### Properties

#### `title: string`

Title displayed in the alert. Usually a short string.

#### `message: string`

Detailed message displayed in the alert.

### Constructor

#### `new Alert()`

Constructs a new alert.

### Methods

#### `addAction(title: string)`

Adds an action to the alert.

Adds an action button to the alert. To check if an action was selected, you should use the first parameter provided when the promise returned by presentAlert() and presentSheet() is resolved.

**Parameters:**
- `title` (string): Title of the action.

#### `addDestructiveAction(title: string)`

Adds a destructive action to the alert.

Destructive action titles have a red text color, signaling that the action may modify or delete data.

**Parameters:**
- `title` (string): Title of the action.

#### `addCancelAction(title: string)`

Adds a cancel action to the alert.

Adds a cancel action to the alert. When a cancel action is selected, the index provided by presentAlert() or presentSheet() will always be -1. Please note that when running on the iPad and presenting using presentSheet(), the action will not be shown in the list of actions. The operation is cancelled by tapping outside the sheet.

An alert can only contain a single cancel action. Attempting to add more cancel actions will remove any previously added cancel actions.

**Parameters:**
- `title` (string): Title of the action.

#### `addTextField(placeholder: string, text: string): TextField`

Adds a text field prompting for user input.

Adds a text field to the alert controller prompting for user input. Retrieve the value for the text field using textFieldValue() and supply the index of the text field. Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

Text fields are not supported when using the sheet presentation.

**Parameters:**
- `placeholder` (string): Optional placeholder that will be displayed when the text field is empty.
- `text` (string): Optional default value for the text field.

**Return value:**
- `TextField`: Text field added to the alert.

#### `addSecureTextField(placeholder: string, text: string): TextField`

Adds a secure text field prompting for user input.

Adds a secure text field to the alert controller prompting for user input. Values entered into a secure text field will be hidden behind dots. Retrieve the value for the text field using textFieldValue() and supply the index of the text field. Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

**Parameters:**
- `placeholder` (string): Optional placeholder that will be displayed when the text field is empty.
- `text` (string): Optional default value for the text field.

**Return value:**
- `TextField`: Text field added to the alert.

#### `textFieldValue(index: number): string`

Retrieves value of a text field.

Retrieves the value of a text field added using addTextField() or addSecureTextField(). Indices for text fields are assigned in the same order as they are added to the alert starting at 0.

**Parameters:**
- `index` (number): Index of text field to retrieve for value.

**Return value:**
- `string`: Value of the text field at the specified index.

#### `present(): Promise<number>`

Presents the alert modally.

This is a shorthand for presentAlert().

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

#### `presentAlert(): Promise<number>`

Presents the alert modally.

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

#### `presentSheet(): Promise<number>`

Presents the alert as a sheet.

**Return value:**
- `Promise<number>`: A promise carrying the selected action index when fulfilled.

---

## Calendar

Holds reminders and events.

Use the Calendar type to get a specific calendar. The calendar is used with the Reminder and CalendarEvent types when fetching reminders or events from a specific calendar or when inserting into a calendar. If you are fetching reminders or events from all calendars, you do not need to pass the calendars when performing the fetch with the Reminder or CalendarEvent types.

### Properties

#### `identifier: string`

Calendar identifier.

*Read-only.*

#### `title: string`

Title of calendar.

#### `isSubscribed: bool`

Whether the calendar is a subscribed calendar.

*Read-only.*

#### `allowsContentModifications: bool`

Indicates whether items can be added, edited, and deleted in the calendar.

*Read-only.*

#### `color: Color`

Color of calendar.

### Methods

#### `supportsAvailability(availability: string): bool`

Checks if the calendar supports availability.

The following values are supported:
- busy
- free
- tentative
- unavailable

Not all calendars support all of these availabilities and some calendars may not support availability at all. Use this function to check if the calendar supports a specific availability.

**Parameters:**
- `availability` (string): Availability to check against.

**Return value:**
- `bool`: True if the calendar supports the availability, otherwise false.

#### `save()`

Saves calendar.

Saves changes to the calendar.

#### `remove()`

Removes calendar.

The calendar is removed immediately. This cannot be undone.

### Static Methods

#### `forReminders(): Promise<[Calendar]>`

Fetches calendars for reminders.

A calendar can only hold either reminders or events. Call this function to fetch all calendars that can hold reminders.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

#### `forEvents(): Promise<[Calendar]>`

Fetches calendars for events.

A calendar can only hold either reminders or events. Call this function to fetch all calendars that can hold events.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

#### `forRemindersByTitle(title: string): Promise<Calendar>`

Fetches a calendar that holds reminders.

**Parameters:**
- `title` (string): Title of calendar.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `forEventsByTitle(title: string): Promise<Calendar>`

Fetches a calendar that holds events.

**Parameters:**
- `title` (string): Title of calendar.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `createForReminders(title: string): Promise<Calendar>`

Create a new calendar that holds reminders.

This will create a new list for reminders in the Reminders app. The list is automatically saved so there is no need to call `save()` after creating the list.

**Return value:**
- `Promise<Calendar>`: Promise that provides the created calendar when fulfilled.

#### `findOrCreateForReminders(title: string): Promise<Calendar>`

Find or create a new calendar that holds reminders.

This will attempt to find a calendar for reminders with the specified name. If no calendar is found, a new calendar is created and the calendar will appear as a reminder list in the Reminders app. If multiple calendars are found for the specified name, the first one will be returned. The list is automatically saved so there is no need to call `save()` in the case the list was created.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `defaultForReminders(): Promise<Calendar>`

Default calendar for reminders.

A calendar can only hold either reminders or events. Call this function to get the default calendar that can hold reminders.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `defaultForEvents(): Promise<Calendar>`

Default calendar for events.

A calendar can only hold either reminders or events. Call this function to get the default calendar that can hold events.

**Return value:**
- `Promise<Calendar>`: Promise that provides the calendar when fulfilled.

#### `presentPicker(allowMultiple: bool): Promise<[Calendar]>`

Presents a view for picking calendars.

**Parameters:**
- `allowMultiple` (bool): Whether to allow picking multiple calenders. Defaults to false.

**Return value:**
- `Promise<[Calendar]>`: Promise that provides the calendars when fulfilled.

---