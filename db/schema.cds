namespace company.leave;

entity Employees {
    key ID            : UUID;
        employeeId    : String(10);
        name          : String(100);
        designation : String(50);
        joiningDate : Date;
        status : String(20);
        role         : String(20) default 'Employee';
        manager : Association to Employees;
        department    :  Association to Departments;
        leaveBalances : Composition of many LeaveBalances on leaveBalances.employee = $self;
        leaveRequests : Composition of many LeaveRequests on leaveRequests.employee = $self;
}

entity LeaveRequests {
    key ID        : UUID;
        employee  : Association to Employees;
        leaveType : Association to LeaveTypes;
        fromDate  : Date;
        toDate    : Date;
        reason    : String(200);
        status    : String(20);
}

entity LeaveBalances {
    key ID            : UUID;
    employee          : Association to Employees;
    leaveType         : Association to LeaveTypes;
    totalLeave        : Integer;
    usedLeave         : Integer default 0;
    remainingLeave    : Integer;
}

entity LeaveTypes {
    key ID               : UUID;
        name             : String(30);
        yearlyAllocation : Integer;
        description      : String(100);
}

entity Departments {
    key ID : UUID;
    name : String(50);
}

entity Holidays{
    key ID : UUID;
    HolidayName : String(100);
    holidayDate : Date;
    description : String(200);
    isOptional  : Boolean default false;
    isActive    : Boolean default true;
}

entity Notifications {
    key ID          : UUID;
    recipient       : Association to Employees;
    title           : String(100);
    message         : String(500);
    type            : String(30);
    isRead          : Boolean default false;
    createdAt       : Timestamp;
}

entity AuditLogs {
    key ID          : UUID;
    action          : String(50);
    performedBy     : Association to Employees;
    leaveRequest    : Association to LeaveRequests;
    oldStatus       : String(30);
    newStatus       : String(30);
    description     : String(500);
    createdAt       : Timestamp;
}